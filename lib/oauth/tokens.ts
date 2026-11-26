import { createHash, randomBytes, timingSafeEqual } from 'crypto';

/**
 * Secrets of the authorization server, and PKCE.
 *
 * - authorization code: `oct_ac_` + 32 random bytes base64url (256 bits)
 * - refresh token:      `oct_rt_` + 32 random bytes base64url (256 bits)
 * - access token:       an API key, `oct_live_...` (lib/api/keys.ts)
 *
 * Only sha256 digests are stored. The prefixes make leaked tokens easy to
 * recognise (secret scanners, logs) and let /oauth/revoke tell them apart.
 *
 * Pure, so it is unit tested on its own.
 */

export const AUTHORIZATION_CODE_PREFIX = 'oct_ac_';
export const REFRESH_TOKEN_PREFIX = 'oct_rt_';

const CODE_RE = /^oct_ac_[A-Za-z0-9_-]{43}$/;
const REFRESH_RE = /^oct_rt_[A-Za-z0-9_-]{43}$/;
/** RFC 7636 section 4.1: 43 to 128 unreserved characters. */
const VERIFIER_RE = /^[A-Za-z0-9._~-]{43,128}$/;
/** base64url(sha256(verifier)), no padding: always 43 characters. */
const CHALLENGE_RE = /^[A-Za-z0-9_-]{43}$/;

export function generateAuthorizationCode(): string {
  return AUTHORIZATION_CODE_PREFIX + randomBytes(32).toString('base64url');
}

export function generateRefreshToken(): string {
  return REFRESH_TOKEN_PREFIX + randomBytes(32).toString('base64url');
}

export function isAuthorizationCodeFormat(value: unknown): value is string {
  return typeof value === 'string' && CODE_RE.test(value);
}

export function isRefreshTokenFormat(value: unknown): value is string {
  return typeof value === 'string' && REFRESH_RE.test(value);
}

/** sha256 hex, as stored in code_hash / token_hash. */
export function hashSecret(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

export function isCodeChallenge(value: unknown): value is string {
  return typeof value === 'string' && CHALLENGE_RE.test(value);
}

export function isCodeVerifier(value: unknown): value is string {
  return typeof value === 'string' && VERIFIER_RE.test(value);
}

/** The S256 challenge of a verifier. */
export function s256Challenge(verifier: string): string {
  return createHash('sha256').update(verifier, 'ascii').digest('base64url');
}

/** RFC 7636 S256 check (the only method supported). */
export function verifyPkce(verifier: unknown, challenge: string): boolean {
  if (!isCodeVerifier(verifier) || !isCodeChallenge(challenge)) return false;
  const expected = Buffer.from(challenge, 'ascii');
  const actual = Buffer.from(s256Challenge(verifier), 'ascii');
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
