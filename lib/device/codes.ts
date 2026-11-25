import { createHash, randomBytes, randomInt } from 'crypto';

/**
 * Codes and constants of the device authorization flow (RFC 8628 style):
 * a headless agent asks POST /api/v1/device/code for a `device_code` (secret,
 * kept by the agent) and a `user_code` (shown to the user, typed or confirmed
 * at /activate), then polls POST /api/v1/device/token until the user approves.
 *
 * - device_code: 32 random bytes, base64url (256 bits). Only its sha256 is
 *   stored, so a database read never yields a pollable code.
 * - user_code: 8 characters from the RFC 8628 section 6.1 consonant alphabet
 *   (no vowels, so no words; no 0/O/1/I), shown as `WDJB-MJHT`. 20^8 is about
 *   2^34.6; with a 15-minute lifetime, a signed-in session required to try a
 *   code, and per-user lookup limits, guessing a live code is impractical.
 *
 * Pure, so it is unit tested on its own.
 */

export const USER_CODE_ALPHABET = 'BCDFGHJKLMNPQRSTVWXZ';
export const USER_CODE_LENGTH = 8;
/** Seconds a device authorization request stays valid. */
export const DEVICE_CODE_EXPIRES_IN = 900;
/** Minimum seconds between polls of /api/v1/device/token. */
export const DEVICE_POLL_INTERVAL = 5;
export const DEVICE_CLIENT_NAME_MAX_LENGTH = 60;
export const DEVICE_SCOPES = ['compile'] as const;
export type DeviceScope = (typeof DEVICE_SCOPES)[number];
export const DEVICE_CODE_GRANT_TYPE = 'urn:ietf:params:oauth:grant-type:device_code';

export const ACTIVATE_PATH = '/activate';
export const DEVICE_CODE_PATH = '/api/v1/device/code';
export const DEVICE_TOKEN_PATH = '/api/v1/device/token';
export const DEVELOPERS_DOCS_URL = 'https://www.useoctree.com/developers';

const DEVICE_CODE_RE = /^[A-Za-z0-9_-]{43}$/;

/** A fresh device code: 32 random bytes as 43 base64url characters. */
export function generateDeviceCode(): string {
  return randomBytes(32).toString('base64url');
}

export function isDeviceCodeFormat(value: unknown): value is string {
  return typeof value === 'string' && DEVICE_CODE_RE.test(value);
}

/** sha256 hex digest stored in `device_authorizations.device_code_hash`. */
export function hashDeviceCode(code: string): string {
  return createHash('sha256').update(code, 'utf8').digest('hex');
}

/** A fresh user code, `XXXX-XXXX`, uniformly random over the alphabet. */
export function generateUserCode(random: (max: number) => number = randomInt): string {
  let raw = '';
  for (let i = 0; i < USER_CODE_LENGTH; i++) raw += USER_CODE_ALPHABET[random(USER_CODE_ALPHABET.length)];
  return formatUserCode(raw);
}

function formatUserCode(raw: string): string {
  return `${raw.slice(0, 4)}-${raw.slice(4)}`;
}

/**
 * What the user typed (any case, spaces or dashes) as the canonical
 * `XXXX-XXXX`, or null when it cannot be a user code.
 */
export function normalizeUserCode(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 32) return null;
  const raw = value.toUpperCase().replace(/[\s-]/g, '');
  if (raw.length !== USER_CODE_LENGTH) return null;
  for (const ch of raw) if (!USER_CODE_ALPHABET.includes(ch)) return null;
  return formatUserCode(raw);
}

/**
 * The optional `client_name` (shown to the user on /activate): trimmed,
 * single-line, at most 60 characters. Missing or blank is `name: null`.
 */
export function parseClientName(value: unknown): { ok: true; name: string | null } | { ok: false } {
  if (value === undefined || value === null) return { ok: true, name: null };
  if (typeof value !== 'string') return { ok: false };
  // Control characters out, whitespace collapsed: it is rendered on the consent page.
  const clean = value.replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩]/g, ' ').trim().replace(/\s+/g, ' ');
  if (!clean) return { ok: true, name: null };
  if (clean.length > DEVICE_CLIENT_NAME_MAX_LENGTH) return { ok: false };
  return { ok: true, name: clean };
}

/** The API key name for a device approval: `<client name> (device)`, within the 64-character key name limit. */
export function deviceKeyName(clientName: string | null | undefined): string {
  const base = (clientName ?? '').trim() || 'Agent';
  return `${base.slice(0, 55).trim()} (device)`;
}

export function verificationUri(origin: string): string {
  return `${origin.replace(/\/+$/, '')}${ACTIVATE_PATH}`;
}

export function verificationUriComplete(origin: string, userCode: string): string {
  return `${verificationUri(origin)}?code=${encodeURIComponent(userCode)}`;
}

/** /activate, optionally with a code and a result to show. */
export function activatePath(params: { code?: string | null; error?: ActivateError; done?: 'approved' | 'denied' } = {}): string {
  const search = new URLSearchParams();
  if (params.code) search.set('code', params.code);
  if (params.error) search.set('error', params.error);
  if (params.done) search.set('done', params.done);
  const qs = search.toString();
  return qs ? `${ACTIVATE_PATH}?${qs}` : ACTIVATE_PATH;
}

/** The login page, coming back to /activate (with the code) afterwards. */
export function loginPathForActivate(code?: string | null): string {
  return `/auth/login?next=${encodeURIComponent(activatePath({ code }))}`;
}

export interface CredentialHints {
  device_authorization_endpoint: string;
  token_endpoint: string;
  docs: string;
}

/**
 * Machine-readable onboarding hints added to every 401 of /api/v1/* and
 * /api/mcp (lib/api/auth.ts), so an agent with no credentials can get a key
 * by itself: start device authorization, show the user one link, poll.
 */
export function credentialHints(origin: string): CredentialHints {
  const base = origin.replace(/\/+$/, '');
  return {
    device_authorization_endpoint: `${base}${DEVICE_CODE_PATH}`,
    token_endpoint: `${base}${DEVICE_TOKEN_PATH}`,
    docs: DEVELOPERS_DOCS_URL,
  };
}

/** The 401 message when no credentials were sent. */
export function noCredentialsMessage(origin: string): string {
  const base = origin.replace(/\/+$/, '');
  return (
    `No credentials. Start device authorization: POST ${base}${DEVICE_CODE_PATH}, then ask the user to open ` +
    `verification_uri_complete; poll ${DEVICE_TOKEN_PATH}. Or send "Authorization: Bearer oct_live_..." ` +
    `(an API key from Settings > API).`
  );
}

export type ActivateError = 'not_found' | 'key_limit' | 'failed' | 'invalid' | 'rate_limited';

export function parseActivateError(value: unknown): ActivateError | null {
  return value === 'not_found' || value === 'key_limit' || value === 'failed' || value === 'invalid' || value === 'rate_limited'
    ? value
    : null;
}
