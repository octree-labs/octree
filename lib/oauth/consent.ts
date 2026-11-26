import { createHash, createHmac, hkdfSync, timingSafeEqual } from 'crypto';
import { authorizeQuery, type AuthorizeParams } from '@/lib/oauth/authorize';
import { AUTHORIZE_PATH } from '@/lib/oauth/metadata';
import { createRateLimiter } from '@/lib/import/rate-limit';

/**
 * Consent form protection for /oauth/authorize -> POST /oauth/authorize/decision.
 *
 * The decision route accepts a POST only when
 *   1. the Origin header is this origin (or, without one, Sec-Fetch-Site is
 *      same-origin): a cross-site form cannot submit it; and
 *   2. it carries a token minted for the page: HMAC-SHA256 over the signed-in
 *      user id, an expiry (10 minutes) and a digest of the exact authorize
 *      parameters, so a token cannot be replayed for another user, client,
 *      redirect_uri or PKCE challenge.
 * The page is also never framed (X-Frame-Options DENY + frame-ancestors
 * 'none', next.config.ts), against clickjacking the Approve button.
 *
 * Key: HKDF over OAUTH_CONSENT_SECRET, else DEVICE_FLOW_SECRET, else
 * SUPABASE_SERVICE_ROLE_KEY (like lib/device/crypto.ts).
 */

export const CONSENT_TOKEN_TTL_MS = 10 * 60_000;

export function consentSecret(env: Record<string, string | undefined> = process.env): string | null {
  for (const name of ['OAUTH_CONSENT_SECRET', 'DEVICE_FLOW_SECRET', 'SUPABASE_SERVICE_ROLE_KEY']) {
    const value = env[name]?.trim();
    if (value) return value;
  }
  return null;
}

function key(secret: string): Buffer {
  return Buffer.from(hkdfSync('sha256', Buffer.from(secret, 'utf8'), 'octree-oauth-consent', 'octree/oauth-consent/v1', 32));
}

function digest(params: AuthorizeParams): string {
  return createHash('sha256').update(authorizeQuery(params), 'utf8').digest('base64url');
}

function sign(secret: string, userId: string, exp: number, params: AuthorizeParams): string {
  return createHmac('sha256', key(secret)).update(`${userId}|${exp}|${digest(params)}`).digest('base64url');
}

export function createConsentToken(secret: string, userId: string, params: AuthorizeParams, now = Date.now()): string {
  const exp = now + CONSENT_TOKEN_TTL_MS;
  return `${exp}.${sign(secret, userId, exp, params)}`;
}

export function verifyConsentToken(
  secret: string,
  token: unknown,
  userId: string,
  params: AuthorizeParams,
  now = Date.now()
): boolean {
  if (typeof token !== 'string') return false;
  const [expText, mac, extra] = token.split('.');
  if (extra !== undefined || !expText || !mac || !/^\d{1,15}$/.test(expText)) return false;
  const exp = Number(expText);
  if (exp <= now) return false;
  const expected = Buffer.from(sign(secret, userId, exp, params));
  const actual = Buffer.from(mac);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

/** Whether a POST comes from this origin's own page. */
export function isSameOriginPost(headers: Headers, origin: string): boolean {
  const sent = headers.get('origin');
  if (sent) return sent === origin;
  return headers.get('sec-fetch-site') === 'same-origin';
}

/** `https://host` of the current request, from its headers (server components have no request URL). */
export function originFromHeaders(headers: Headers): string {
  // `host` first: the Tools proxy sets x-forwarded-host to its own domain (lib/auth/redirect.ts).
  const host = headers.get('host') || headers.get('x-forwarded-host')?.split(',')[0]?.trim() || 'app.useoctree.com';
  const forwarded = headers.get('x-forwarded-proto')?.split(',')[0]?.trim();
  const proto = forwarded || (/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host) ? 'http' : 'https');
  return `${proto}://${host}`;
}

export function authorizePath(params: AuthorizeParams, extra: Record<string, string> = {}): string {
  const search = new URLSearchParams(authorizeQuery(params));
  for (const [name, value] of Object.entries(extra)) search.set(name, value);
  const qs = search.toString();
  return qs ? `${AUTHORIZE_PATH}?${qs}` : AUTHORIZE_PATH;
}

/** The login page, coming back to this authorization request afterwards. */
export function loginPathForAuthorize(params: AuthorizeParams): string {
  return `/auth/login?next=${encodeURIComponent(authorizePath(params))}`;
}

/** Approve/deny decisions per signed-in user: 30 per 10 minutes (per process). */
const globalForConsent = globalThis as unknown as { __octreeOAuthConsentLimiter__?: ReturnType<typeof createRateLimiter> };
const decisionLimiter = (globalForConsent.__octreeOAuthConsentLimiter__ ??= createRateLimiter({ limit: 30, windowMs: 10 * 60_000 }));

export function allowConsentDecision(userId: string, now = Date.now()): boolean {
  return decisionLimiter.check(userId, now).allowed;
}
