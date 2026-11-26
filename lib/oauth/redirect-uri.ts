/**
 * Redirect URI rules of the authorization server.
 *
 * Registration (DCR and Client ID Metadata Documents) accepts:
 *   - https URLs (no userinfo, no fragment)
 *   - http only on a loopback host: 127.0.0.1, [::1], localhost (RFC 8252
 *     section 7.3; `localhost` too, because Claude Code declares it)
 *   - private-use schemes of native apps (cursor://, vscode://,
 *     com.example.app:/cb), except schemes a browser would run or read
 *     locally (javascript:, data:, file:, blob:, ...)
 *
 * Matching an authorization request against the registered list is exact
 * string comparison, except that a loopback http redirect matches whatever
 * its port is (the client picks an ephemeral port per session). The host,
 * path and query must still be identical.
 *
 * Pure, so it is unit tested on its own.
 */

export const REDIRECT_URI_MAX_LENGTH = 2000;
export const MAX_REDIRECT_URIS = 10;

const LOOPBACK_HOSTS = new Set(['127.0.0.1', '[::1]', 'localhost']);
const SCHEME_RE = /^[a-z][a-z0-9+.-]*:/i;
const BLOCKED_SCHEMES = new Set([
  'javascript',
  'data',
  'file',
  'blob',
  'filesystem',
  'about',
  'vbscript',
  'view-source',
  'chrome',
  'chrome-extension',
  'moz-extension',
  'ms-browser-extension',
  'resource',
  'jar',
  'intent',
  'ftp',
  'ws',
  'wss',
  'mailto',
  'tel',
  'sms',
  'http',
  'https',
]);

export type RedirectUriCheck = { ok: true; uri: string } | { ok: false; reason: string };

function parse(uri: string): URL | null {
  try {
    return new URL(uri);
  } catch {
    return null;
  }
}

export function isLoopbackHost(hostname: string): boolean {
  return LOOPBACK_HOSTS.has(hostname.toLowerCase());
}

/** Whether a (valid) redirect URI is a loopback http one. */
export function isLoopbackRedirect(uri: string): boolean {
  const url = parse(uri);
  return Boolean(url && url.protocol === 'http:' && isLoopbackHost(url.hostname));
}

/** Validates one redirect URI offered at registration. */
export function checkRedirectUri(value: unknown): RedirectUriCheck {
  if (typeof value !== 'string' || !value) return { ok: false, reason: 'redirect_uris must be non-empty strings.' };
  if (value.length > REDIRECT_URI_MAX_LENGTH) return { ok: false, reason: 'A redirect URI is too long.' };
  if (/[\u0000- \u007f]/.test(value)) return { ok: false, reason: 'A redirect URI contains whitespace or control characters.' };
  if (!SCHEME_RE.test(value)) return { ok: false, reason: `Not an absolute URI: ${value.slice(0, 100)}` };
  const url = parse(value);
  if (!url) return { ok: false, reason: `Not a valid URI: ${value.slice(0, 100)}` };
  if (url.hash || value.includes('#')) return { ok: false, reason: 'Redirect URIs must not contain a fragment.' };
  if (url.username || url.password) return { ok: false, reason: 'Redirect URIs must not contain credentials.' };

  const scheme = url.protocol.slice(0, -1).toLowerCase();
  if (scheme === 'https') {
    if (!url.hostname) return { ok: false, reason: 'An https redirect URI needs a host.' };
    return { ok: true, uri: value };
  }
  if (scheme === 'http') {
    if (isLoopbackHost(url.hostname)) return { ok: true, uri: value };
    return { ok: false, reason: 'http redirect URIs are only allowed on 127.0.0.1, [::1] or localhost; use https.' };
  }
  if (BLOCKED_SCHEMES.has(scheme)) return { ok: false, reason: `The ${scheme}: scheme is not allowed for redirect URIs.` };
  // A private-use scheme needs something after it (cursor://callback, com.app:/cb).
  if (value.length <= scheme.length + 1) return { ok: false, reason: 'A custom-scheme redirect URI needs a path.' };
  return { ok: true, uri: value };
}

/** All URIs valid, 1 to 10 of them, or the first problem. */
export function checkRedirectUris(value: unknown): { ok: true; uris: string[] } | { ok: false; reason: string } {
  if (!Array.isArray(value) || value.length === 0) return { ok: false, reason: 'redirect_uris must be a non-empty array.' };
  if (value.length > MAX_REDIRECT_URIS) return { ok: false, reason: `At most ${MAX_REDIRECT_URIS} redirect_uris.` };
  const uris: string[] = [];
  for (const item of value) {
    const check = checkRedirectUri(item);
    if (!check.ok) return check;
    if (!uris.includes(check.uri)) uris.push(check.uri);
  }
  return { ok: true, uris };
}

/** Whether a presented redirect_uri matches one registered value (loopback: any port). */
export function redirectUriMatches(registered: string, presented: string): boolean {
  if (registered === presented) return true;
  const a = parse(registered);
  const b = parse(presented);
  if (!a || !b) return false;
  if (a.protocol !== 'http:' || b.protocol !== 'http:') return false;
  if (!isLoopbackHost(a.hostname) || a.hostname !== b.hostname) return false;
  if (b.username || b.password || b.hash || presented.includes('#')) return false;
  return a.pathname === b.pathname && a.search === b.search;
}

/** The registered URI a presented one matches, or null. */
export function findMatchingRedirectUri(registered: readonly string[], presented: string): string | null {
  if (presented.length > REDIRECT_URI_MAX_LENGTH) return null;
  return registered.find((uri) => redirectUriMatches(uri, presented)) ?? null;
}

/** What the consent screen shows for where the user is sent: a host, or `cursor://` for app schemes. */
export function redirectDisplay(uri: string): { label: string; loopback: boolean; app: boolean } {
  const url = parse(uri);
  if (!url) return { label: uri.slice(0, 80), loopback: false, app: false };
  if (url.protocol === 'https:' || url.protocol === 'http:') {
    return { label: url.host, loopback: url.protocol === 'http:' && isLoopbackHost(url.hostname), app: false };
  }
  return { label: `${url.protocol}//${url.host}`.replace(/\/\/$/, ''), loopback: false, app: true };
}
