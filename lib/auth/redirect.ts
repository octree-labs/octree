type HeaderRecord = Record<string, string>;

function headersToRecord(headers: Headers | HeaderRecord): HeaderRecord {
  if (headers instanceof Headers) {
    const record: HeaderRecord = {};
    headers.forEach((value, key) => {
      record[key.toLowerCase()] = value;
    });
    return record;
  }
  const record: HeaderRecord = {};
  for (const [key, value] of Object.entries(headers)) {
    if (typeof value === 'string') {
      record[key.toLowerCase()] = value;
    }
  }
  return record;
}

function parseHeaderList(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
}

const SAFE_PATH_BASE = 'https://redirect-path.invalid';

/**
 * Returns `value` as a same-origin, app-relative path (pathname + search +
 * hash), or null if it could point anywhere else. Every user-supplied `next`
 * must go through this before it is used as a redirect target: browsers treat
 * `//host` and `/\host` as protocol-relative, and strip tabs/newlines before
 * parsing, so a plain `startsWith('/')` check is not enough.
 */
export function safeRedirectPath(value: unknown, sameOrigin?: string): string | null {
  if (typeof value !== 'string' || value.length === 0) return null;
  // An absolute URL on our own origin (e.g. an email link that carries the
  // full redirect URL) is reduced to its path; any other origin is rejected.
  if (sameOrigin && !value.startsWith('/')) {
    let absolute: URL;
    try {
      absolute = new URL(value);
    } catch {
      return null;
    }
    if (absolute.origin !== new URL(sameOrigin).origin) return null;
    return safeRedirectPath(`${absolute.pathname}${absolute.search}${absolute.hash}`);
  }
  if (!value.startsWith('/')) return null;
  if (value.startsWith('//') || value.startsWith('/\\')) return null;
  if (value.includes('\\')) return null;
  // Control characters (the URL parser silently drops tab/CR/LF, which would
  // turn `/\t/host` into `//host`). A plain space after the leading slash is
  // harmless: the parser percent-encodes it.
  if (/[\u0000-\u001f\u007f]/.test(value)) return null;
  let url: URL;
  try {
    url = new URL(value, SAFE_PATH_BASE);
  } catch {
    return null;
  }
  if (url.origin !== SAFE_PATH_BASE) return null;
  const path = `${url.pathname}${url.search}${url.hash}`;
  // The normalised path must itself still be app-relative.
  if (!path.startsWith('/') || path.startsWith('//')) return null;
  return path;
}

/**
 * Resolve the host + protocol used for post-OAuth redirects.
 *
 * When the editor is launched from the Tools hub the request is proxied through
 * `tools.useoctree.com`, which populates `x-forwarded-host` with the Tools domain.
 * If we redirect to that forwarded host the browser stays on the Tools origin and
 * the Supabase session cookie never reaches the editor domain. By preferring whichever
 * header matches the origin host we land back on the editor origin and the session
 * becomes visible to the app, even when the proxy swaps the header roles.
 */
export function resolveRedirectBase(
  headersInput: Headers | HeaderRecord,
  origin: URL,
  allowedHostsEnv = process.env.ALLOWED_REDIRECT_HOSTS
): URL {
  const headers = headersToRecord(headersInput);

  const allowList = new Set<string>();
  const fallbackHost = origin.host;
  allowList.add(fallbackHost);

  if (allowedHostsEnv) {
    for (const host of allowedHostsEnv.split(',').map((value) => value.trim())) {
      if (host) {
        allowList.add(host);
      }
    }
  }

  const hostHeaders = parseHeaderList(headers['host']);
  const forwardedHosts = parseHeaderList(headers['x-forwarded-host']);

  const protoCandidates = parseHeaderList(headers['x-forwarded-proto']);
  const protocol = protoCandidates[0] ?? origin.protocol.replace(':', '');

  if (allowList.has(origin.host)) {
    if (hostHeaders.includes(origin.host)) {
      return new URL(`${protocol}://${origin.host}`);
    }

    if (forwardedHosts.includes(origin.host)) {
      return new URL(`${protocol}://${origin.host}`);
    }
  }

  const candidates = [...hostHeaders, ...forwardedHosts, origin.host].filter(Boolean);

  const host = candidates.find((candidate) => allowList.has(candidate)) ?? fallbackHost;

  return new URL(`${protocol}://${host}`);
}

export function buildRedirectUrl(
  headers: Headers | HeaderRecord,
  origin: string,
  nextPath: string,
  allowedHostsEnv = process.env.ALLOWED_REDIRECT_HOSTS
): string {
  const baseUrl = resolveRedirectBase(headers, new URL(origin), allowedHostsEnv);
  const url = new URL(safeRedirectPath(nextPath) ?? '/', baseUrl);
  // Defense in depth: never leave the resolved base origin.
  if (url.origin !== baseUrl.origin) return new URL('/', baseUrl).toString();
  return url.toString();
}
