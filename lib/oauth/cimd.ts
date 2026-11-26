import 'server-only';

import { lookup as dnsLookup } from 'node:dns';
import { request as httpsRequest } from 'node:https';
import { isIP } from 'node:net';
import type { LookupFunction } from 'node:net';
import { parseCimdDocument, isCimdClientId, type ClientInfo } from '@/lib/oauth/clients';

/**
 * Client ID Metadata Documents (draft-ietf-oauth-client-id-metadata-document):
 * a client whose client_id is an https URL publishes its metadata (name,
 * redirect_uris) there, and the authorization server fetches it. Claude
 * (claude.ai and Claude Code) uses this when the server metadata advertises
 * `client_id_metadata_document_supported`.
 *
 * The URL comes from an unauthenticated party, so the fetch is guarded
 * against SSRF:
 *   - https only, a DNS name (no IP literals), default port or 443
 *   - every address the name resolves to must be public; the check runs in
 *     the socket's own lookup, so a DNS answer cannot change between the
 *     check and the connection (no rebinding window)
 *   - no redirects, 5 second timeout, 16 KB cap on the body
 * Results (and failures, briefly) are cached per process: successes for the
 * document's max-age clamped to 1 minute..1 hour (5 minutes by default).
 *
 * Only called for signed-in users on /oauth/authorize and its decision
 * route, never by an anonymous request.
 */

export const CIMD_FETCH_TIMEOUT_MS = 5_000;
export const CIMD_MAX_BYTES = 16 * 1024;
const CACHE_DEFAULT_MS = 5 * 60_000;
const CACHE_MIN_MS = 60_000;
const CACHE_MAX_MS = 60 * 60_000;
const NEGATIVE_CACHE_MS = 30_000;
const CACHE_MAX_ENTRIES = 500;

// ---------------------------------------------------------------------------
// Address checks
// ---------------------------------------------------------------------------

function ipv4ToInt(ip: string): number {
  return ip.split('.').reduce((acc, part) => (acc << 8) + Number(part), 0) >>> 0;
}

const BLOCKED_V4: Array<[string, number]> = [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
];

function isPublicV4(ip: string): boolean {
  const value = ipv4ToInt(ip);
  return !BLOCKED_V4.some(([base, bits]) => {
    const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
    return (value & mask) === (ipv4ToInt(base) & mask);
  });
}

/** Expands an IPv6 address to 8 16-bit groups, or null. */
function ipv6Groups(ip: string): number[] | null {
  let address = ip.toLowerCase();
  const zone = address.indexOf('%');
  if (zone >= 0) address = address.slice(0, zone);
  // Embedded dotted IPv4 tail (::ffff:1.2.3.4).
  const v4Tail = /(\d+\.\d+\.\d+\.\d+)$/.exec(address);
  if (v4Tail) {
    const n = ipv4ToInt(v4Tail[1]);
    address = address.slice(0, -v4Tail[1].length) + `${(n >>> 16).toString(16)}:${(n & 0xffff).toString(16)}`;
  }
  const halves = address.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const missing = 8 - head.length - tail.length;
  if (halves.length === 1 && missing !== 0) return null;
  if (missing < 0) return null;
  const groups = [...head, ...Array(halves.length === 2 ? missing : 0).fill('0'), ...tail].map((g) => parseInt(g, 16));
  return groups.length === 8 && groups.every((g) => Number.isFinite(g) && g >= 0 && g <= 0xffff) ? groups : null;
}

function isPublicV6(ip: string): boolean {
  const g = ipv6Groups(ip);
  if (!g) return false;
  const first = g[0];
  if (g.every((x) => x === 0)) return false; // ::
  if (g.slice(0, 7).every((x) => x === 0) && g[7] === 1) return false; // ::1
  // IPv4-mapped / -compatible / NAT64: judge the embedded IPv4 address.
  const embedded = `${g[6] >> 8}.${g[6] & 0xff}.${g[7] >> 8}.${g[7] & 0xff}`;
  if (g.slice(0, 5).every((x) => x === 0) && (g[5] === 0xffff || g[5] === 0)) return isPublicV4(embedded);
  if (first === 0x64 && g[1] === 0xff9b) return isPublicV4(embedded);
  if ((first & 0xfe00) === 0xfc00) return false; // fc00::/7 unique local
  if ((first & 0xffc0) === 0xfe80) return false; // fe80::/10 link local
  if ((first & 0xffc0) === 0xfec0) return false; // fec0::/10 site local
  if ((first & 0xff00) === 0xff00) return false; // multicast
  if (first === 0x2001 && g[1] === 0x0db8) return false; // documentation
  if (first === 0x0100 && g[1] === 0 && g[2] === 0 && g[3] === 0) return false; // discard
  if (first === 0x2002) return isPublicV4(`${g[1] >> 8}.${g[1] & 0xff}.${g[2] >> 8}.${g[2] & 0xff}`); // 6to4
  return true;
}

/** Whether an IP address is publicly routable (not private, loopback, link-local, reserved...). */
export function isPublicAddress(ip: string): boolean {
  const family = isIP(ip);
  if (family === 4) return isPublicV4(ip);
  if (family === 6) return isPublicV6(ip);
  return false;
}

/** A socket lookup that refuses any name resolving to a non-public address. */
export const guardedLookup: LookupFunction = (hostname, options, callback) => {
  dnsLookup(hostname, { ...options, all: true }, (error, addresses) => {
    if (error) return (callback as any)(error);
    const list = (addresses as unknown as Array<{ address: string; family: number }>) ?? [];
    if (list.length === 0 || list.some((entry) => !isPublicAddress(entry.address))) {
      const refused = Object.assign(new Error(`Refusing to fetch ${hostname}: it resolves to a non-public address.`), {
        code: 'ENOTPUBLIC',
      });
      return (callback as any)(refused);
    }
    if ((options as { all?: boolean }).all) return (callback as any)(null, list);
    return (callback as any)(null, list[0].address, list[0].family);
  });
};

// ---------------------------------------------------------------------------
// Fetch
// ---------------------------------------------------------------------------

export interface FetchedDocument {
  status: number;
  body: string;
  cacheControl: string | null;
  contentType: string | null;
}

export type DocumentFetcher = (url: string) => Promise<FetchedDocument>;

/** GET over https with the guards above. Rejects on timeout, oversize, or a refused address. */
export const fetchMetadataDocument: DocumentFetcher = (url) =>
  new Promise((resolve, reject) => {
    const target = new URL(url);
    if (target.protocol !== 'https:' || isIP(target.hostname.replace(/^\[|\]$/g, ''))) {
      reject(new Error('Client metadata must be on an https URL with a DNS name.'));
      return;
    }
    const req = httpsRequest(
      target,
      {
        method: 'GET',
        lookup: guardedLookup,
        timeout: CIMD_FETCH_TIMEOUT_MS,
        headers: { Accept: 'application/json', 'User-Agent': 'Octree-OAuth/1.0 (+https://www.useoctree.com/developers)' },
      },
      (res) => {
        const declared = Number(res.headers['content-length'] ?? 0);
        if (declared > CIMD_MAX_BYTES) {
          res.destroy();
          reject(new Error('Client metadata document is too large.'));
          return;
        }
        const chunks: Buffer[] = [];
        let size = 0;
        res.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size > CIMD_MAX_BYTES) {
            res.destroy();
            reject(new Error('Client metadata document is too large.'));
            return;
          }
          chunks.push(chunk);
        });
        res.on('end', () =>
          resolve({
            status: res.statusCode ?? 0,
            body: Buffer.concat(chunks).toString('utf8'),
            cacheControl: (res.headers['cache-control'] as string | undefined) ?? null,
            contentType: (res.headers['content-type'] as string | undefined) ?? null,
          })
        );
        res.on('error', reject);
      }
    );
    const deadline = setTimeout(() => req.destroy(new Error('Client metadata fetch timed out.')), CIMD_FETCH_TIMEOUT_MS);
    req.on('timeout', () => req.destroy(new Error('Client metadata fetch timed out.')));
    req.on('error', (error) => {
      clearTimeout(deadline);
      reject(error);
    });
    req.on('close', () => clearTimeout(deadline));
    req.end();
  });

// ---------------------------------------------------------------------------
// Resolve (with cache)
// ---------------------------------------------------------------------------

export type CimdResult = { ok: true; client: ClientInfo } | { ok: false; reason: string };

interface CacheEntry {
  result: CimdResult;
  expiresAt: number;
}

const globalForCimd = globalThis as unknown as { __octreeCimdCache__?: Map<string, CacheEntry> };
const cache = (globalForCimd.__octreeCimdCache__ ??= new Map());

function maxAgeMs(cacheControl: string | null): number {
  if (!cacheControl) return CACHE_DEFAULT_MS;
  if (/no-store|no-cache/i.test(cacheControl)) return CACHE_MIN_MS;
  const match = /max-age=(\d+)/i.exec(cacheControl);
  if (!match) return CACHE_DEFAULT_MS;
  return Math.min(CACHE_MAX_MS, Math.max(CACHE_MIN_MS, Number(match[1]) * 1000));
}

function remember(url: string, result: CimdResult, ttlMs: number, now: number): CimdResult {
  cache.delete(url);
  cache.set(url, { result, expiresAt: now + ttlMs });
  while (cache.size > CACHE_MAX_ENTRIES) cache.delete(cache.keys().next().value as string);
  return result;
}

/** Fetches, validates and caches the metadata document named by a URL client_id. */
export async function resolveCimdClient(
  clientId: string,
  options: { fetcher?: DocumentFetcher; now?: number } = {}
): Promise<CimdResult> {
  if (!isCimdClientId(clientId)) return { ok: false, reason: 'client_id is not a valid metadata document URL.' };
  const now = options.now ?? Date.now();
  const hit = cache.get(clientId);
  if (hit && hit.expiresAt > now) return hit.result;

  let fetched: FetchedDocument;
  try {
    fetched = await (options.fetcher ?? fetchMetadataDocument)(clientId);
  } catch (error) {
    const reason = `Could not fetch the client metadata document (${error instanceof Error ? error.message : 'error'}).`;
    return remember(clientId, { ok: false, reason }, NEGATIVE_CACHE_MS, now);
  }
  if (fetched.status !== 200) {
    return remember(clientId, { ok: false, reason: `The client metadata document answered HTTP ${fetched.status}.` }, NEGATIVE_CACHE_MS, now);
  }
  let json: unknown;
  try {
    json = JSON.parse(fetched.body);
  } catch {
    return remember(clientId, { ok: false, reason: 'The client metadata document is not JSON.' }, NEGATIVE_CACHE_MS, now);
  }
  const parsed = parseCimdDocument(clientId, json);
  if (!parsed.ok) return remember(clientId, parsed, NEGATIVE_CACHE_MS, now);
  return remember(clientId, parsed, maxAgeMs(fetched.cacheControl), now);
}

/** For tests. */
export function clearCimdCache(): void {
  cache.clear();
}
