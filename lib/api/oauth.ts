import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * Verification of Supabase OAuth 2.1 access tokens for the MCP server and
 * the REST API (lib/api/auth.ts). A token is accepted only when:
 *
 * - its signature and expiry check out: `auth.getClaims(token)` verifies
 *   asymmetric tokens against the project's JWKS (cached) and falls back to
 *   the Auth server (`getUser`) for HS256 projects;
 * - `iss` is this project's issuer (`<supabase url>/auth/v1`);
 * - it carries a `client_id` claim, which Supabase sets only on tokens it
 *   issued to an OAuth client. A plain browser session token (no
 *   `client_id`) is refused, so a leaked app cookie is not an API credential;
 * - `aud` is `authenticated` (Supabase's default for OAuth tokens) or the
 *   MCP resource URL (when a Custom Access Token Hook sets it per RFC 8707);
 * - `role` is `authenticated` and `sub` is a user id.
 */

export interface OAuthTokenClaims {
  userId: string;
  clientId: string;
  expiresAt: number;
  scope: string | null;
}

export type OAuthVerification =
  | { ok: true; claims: OAuthTokenClaims }
  | { ok: false; reason: 'expired' | 'invalid' | 'not_oauth' | 'wrong_audience' | 'wrong_issuer'; message: string };

type ClaimsClient = Pick<SupabaseClient['auth'], 'getClaims'>;

let cachedClient: ClaimsClient | null = null;

/** A long-lived anon client, so its JWKS cache survives between requests. */
function defaultClient(): ClaimsClient {
  if (!cachedClient) {
    cachedClient = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
    }).auth;
  }
  return cachedClient;
}

const JWT_RE = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;

/** Three base64url segments: worth verifying as a JWT. */
export function looksLikeJwt(token: string): boolean {
  return token.length < 8192 && JWT_RE.test(token);
}

/** The unverified payload, only to tell an expired token from a forged one before any network call. */
function peekPayload(token: string): Record<string, unknown> | null {
  try {
    const json = Buffer.from(token.split('.')[1], 'base64url').toString('utf8');
    const payload = JSON.parse(json);
    return typeof payload === 'object' && payload !== null ? payload : null;
  } catch {
    return null;
  }
}

function audiences(aud: unknown): string[] {
  if (typeof aud === 'string') return [aud];
  if (Array.isArray(aud)) return aud.filter((a): a is string => typeof a === 'string');
  return [];
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface VerifyOptions {
  issuer: string;
  /** The MCP resource URL, accepted as an audience next to `authenticated`. */
  resource: string;
  client?: ClaimsClient;
  now?: number;
}

export async function verifyOAuthAccessToken(token: string, options: VerifyOptions): Promise<OAuthVerification> {
  const now = options.now ?? Date.now();
  const peek = peekPayload(token);
  if (!peek) return { ok: false, reason: 'invalid', message: 'The access token is not a valid JWT.' };
  if (typeof peek.exp === 'number' && peek.exp * 1000 <= now) {
    return { ok: false, reason: 'expired', message: 'The access token has expired. Refresh it and retry.' };
  }
  // Cheap checks first: a token from another issuer is never sent to the Auth server.
  if (peek.iss !== options.issuer) {
    return { ok: false, reason: 'wrong_issuer', message: 'The access token was not issued by Octree.' };
  }

  const { data, error } = await (options.client ?? defaultClient()).getClaims(token);
  if (error || !data?.claims) {
    return { ok: false, reason: 'invalid', message: 'The access token could not be verified.' };
  }
  const claims = data.claims as Record<string, unknown>;

  if (claims.iss !== options.issuer) {
    return { ok: false, reason: 'wrong_issuer', message: 'The access token was not issued by Octree.' };
  }
  const exp = typeof claims.exp === 'number' ? claims.exp : 0;
  if (exp * 1000 <= now) {
    return { ok: false, reason: 'expired', message: 'The access token has expired. Refresh it and retry.' };
  }
  const clientId = typeof claims.client_id === 'string' && claims.client_id ? claims.client_id : null;
  if (!clientId) {
    return {
      ok: false,
      reason: 'not_oauth',
      message: 'This token is an app session, not an OAuth access token. Connect through OAuth or use an API key.',
    };
  }
  const aud = audiences(claims.aud);
  if (!aud.includes('authenticated') && !aud.includes(options.resource)) {
    return { ok: false, reason: 'wrong_audience', message: 'The access token is not meant for this server.' };
  }
  if (claims.role !== 'authenticated' || typeof claims.sub !== 'string' || !UUID_RE.test(claims.sub)) {
    return { ok: false, reason: 'invalid', message: 'The access token does not belong to a user.' };
  }
  return {
    ok: true,
    claims: {
      userId: claims.sub,
      clientId,
      expiresAt: exp * 1000,
      scope: typeof claims.scope === 'string' ? claims.scope : null,
    },
  };
}
