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
  return new URL(nextPath, baseUrl).toString();
}
