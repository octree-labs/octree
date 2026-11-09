import 'server-only';

import { createAdminClient } from '@/lib/supabase/admin';
import { hasUnlimitedEdits } from '@/lib/paywall';
import { proEntitlement } from '@/lib/subscription/entitlement';
import { afterResponse } from '@/lib/posthog-server';
import { clientIp, createRateLimiter } from '@/lib/import/rate-limit';
import { bearerToken, hashApiKey, isApiKeyFormat } from '@/lib/api/keys';
import { apiJson } from '@/lib/api/http';
import type { ApiPlan } from '@/lib/api/quota';

/**
 * Bearer API-key authentication for the public API and the MCP server.
 *
 *   Authorization: Bearer oct_live_...
 *
 * The key is hashed and looked up with the service-role client (the hash
 * column is not readable by users). Keys are never logged. Failed attempts
 * are limited per IP (10 a minute, per process, like the import preview);
 * past that the IP gets 429 without a database lookup until the window
 * clears. `last_used_at` is written at most every 5 minutes per key.
 */

export interface ApiPrincipal {
  userId: string;
  keyId: string;
  plan: ApiPlan;
}

export type ApiAuthResult = { ok: true; principal: ApiPrincipal } | { ok: false; response: Response };

const AUTH_FAILURE_LIMIT = { limit: 10, windowMs: 60_000 };
const LAST_USED_WRITE_INTERVAL_MS = 5 * 60_000;
/** Resolved keys are reused for this long (a revoke takes effect within it). */
const PRINCIPAL_CACHE_MS = 60_000;
const PRINCIPAL_CACHE_MAX = 5_000;

interface CachedPrincipal {
  principal: ApiPrincipal;
  expiresAt: number;
}

const globalForApiAuth = globalThis as unknown as {
  __octreeApiAuthFailures__?: ReturnType<typeof createRateLimiter>;
  __octreeApiAuthBlocked__?: Map<string, number>;
  __octreeApiPrincipals__?: Map<string, CachedPrincipal>;
  __octreeApiLastUsed__?: Map<string, number>;
};
const failures = (globalForApiAuth.__octreeApiAuthFailures__ ??= createRateLimiter(AUTH_FAILURE_LIMIT));
const blocked = (globalForApiAuth.__octreeApiAuthBlocked__ ??= new Map());
const principals = (globalForApiAuth.__octreeApiPrincipals__ ??= new Map());
const lastUsedWrites = (globalForApiAuth.__octreeApiLastUsed__ ??= new Map());

/** 401 + WWW-Authenticate (RFC 6750: no error code when no credentials were sent). */
export function unauthorizedResponse(message: string, invalidToken = true): Response {
  return apiJson({ error: 'unauthorized', message }, 401, {
    'WWW-Authenticate': invalidToken ? 'Bearer realm="octree", error="invalid_token"' : 'Bearer realm="octree"',
  });
}

function rateLimitedResponse(retryAfterSeconds: number): Response {
  return apiJson(
    { error: 'rate_limited', message: 'Too many failed authentication attempts. Try again shortly.' },
    429,
    { 'Retry-After': String(retryAfterSeconds) }
  );
}

function blockedFor(ip: string, now: number): number {
  const until = blocked.get(ip);
  if (!until) return 0;
  if (until <= now) {
    blocked.delete(ip);
    return 0;
  }
  return Math.ceil((until - now) / 1000);
}

function recordFailure(ip: string, message: string): Response {
  const now = Date.now();
  const decision = failures.check(ip, now);
  if (!decision.allowed) {
    blocked.set(ip, now + decision.retryAfterSeconds * 1000);
    if (blocked.size > 10_000) blocked.delete(blocked.keys().next().value as string);
    return rateLimitedResponse(decision.retryAfterSeconds);
  }
  return unauthorizedResponse(message);
}

/** Free or Pro, by the app's one entitlement rule (lib/subscription/entitlement.ts). */
async function resolvePlan(admin: ReturnType<typeof createAdminClient>, userId: string): Promise<ApiPlan> {
  const [{ data: row }, { data: userData }] = await Promise.all([
    admin
      .from('user_usage')
      .select('subscription_status, stripe_subscription_id, current_period_end')
      .eq('user_id', userId)
      .maybeSingle(),
    admin.auth.admin.getUserById(userId),
  ]);
  const hasUnlimited = hasUnlimitedEdits(userData?.user?.email ?? null);
  return proEntitlement({ row, hasUnlimited }).isPro ? 'pro' : 'free';
}

function touchLastUsed(admin: ReturnType<typeof createAdminClient>, keyId: string, now: number): void {
  const last = lastUsedWrites.get(keyId) ?? 0;
  if (now - last < LAST_USED_WRITE_INTERVAL_MS) return;
  lastUsedWrites.set(keyId, now);
  if (lastUsedWrites.size > PRINCIPAL_CACHE_MAX) lastUsedWrites.delete(lastUsedWrites.keys().next().value as string);
  afterResponse(async () => {
    const { error } = await admin
      .from('api_keys')
      .update({ last_used_at: new Date(now).toISOString() })
      .eq('id', keyId);
    if (error) console.error('[api-auth] last_used_at update failed:', error.message);
  });
}

function lookupUnavailable(): ApiAuthResult {
  return {
    ok: false,
    response: apiJson({ error: 'service_unavailable', message: 'Could not verify the API key. Try again.' }, 503, {
      'Retry-After': '5',
    }),
  };
}

/** Resolves the request's API key to a user and plan, or the error response to send. */
export async function authenticateApiRequest(request: Request): Promise<ApiAuthResult> {
  try {
    return await authenticate(request);
  } catch (error) {
    console.error('[api-auth] key lookup threw:', error instanceof Error ? error.message : 'unknown error');
    return lookupUnavailable();
  }
}

async function authenticate(request: Request): Promise<ApiAuthResult> {
  const now = Date.now();
  const ip = clientIp(request.headers);
  const wait = blockedFor(ip, now);
  if (wait > 0) return { ok: false, response: rateLimitedResponse(wait) };

  const token = bearerToken(request.headers.get('authorization'));
  if (!token) {
    // A missing header is how MCP clients discover that auth is needed:
    // answer 401 + WWW-Authenticate, but do not count it as a failure.
    return {
      ok: false,
      response: unauthorizedResponse('Missing API key. Send "Authorization: Bearer oct_live_...".', false),
    };
  }
  if (!isApiKeyFormat(token)) {
    return { ok: false, response: recordFailure(ip, 'Malformed API key. Keys look like oct_live_ followed by 32 characters.') };
  }

  const hash = hashApiKey(token);
  const cached = principals.get(hash);
  const admin = createAdminClient();
  if (cached && cached.expiresAt > now) {
    touchLastUsed(admin, cached.principal.keyId, now);
    return { ok: true, principal: cached.principal };
  }

  const { data: key, error } = await admin
    .from('api_keys')
    .select('id, user_id, revoked_at')
    .eq('key_hash', hash)
    .maybeSingle();
  if (error) {
    console.error('[api-auth] key lookup failed:', error.message);
    return lookupUnavailable();
  }
  if (!key || key.revoked_at) {
    principals.delete(hash);
    return { ok: false, response: recordFailure(ip, 'Invalid or revoked API key.') };
  }

  const plan = await resolvePlan(admin, key.user_id);
  const principal: ApiPrincipal = { userId: key.user_id, keyId: key.id, plan };
  principals.set(hash, { principal, expiresAt: now + PRINCIPAL_CACHE_MS });
  if (principals.size > PRINCIPAL_CACHE_MAX) principals.delete(principals.keys().next().value as string);
  touchLastUsed(admin, key.id, now);
  return { ok: true, principal };
}
