import { createHash, timingSafeEqual } from 'node:crypto';

/**
 * Shared secret between the Next.js proxy (app/api/octra-agent) and this
 * service. Quotas and the paywall are enforced in the proxy, so requests that
 * skip it must be rejected even when they carry a valid user JWT.
 */
export const PROXY_SECRET_HEADER = 'x-octree-proxy-secret';

export type ProxySecretResult =
  | 'ok' // header matches the configured secret
  | 'disabled' // no secret configured: enforcement off (rollout only)
  | 'missing' // secret configured, header absent
  | 'invalid'; // secret configured, header wrong

// Hash both sides so timingSafeEqual gets equal-length buffers and the
// comparison time does not depend on the provided value's length.
function digest(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest();
}

export function safeEqual(a: string, b: string): boolean {
  return timingSafeEqual(digest(a), digest(b));
}

export function checkProxySecret(
  expected: string | undefined,
  provided: string | string[] | undefined
): ProxySecretResult {
  if (!expected) return 'disabled';
  if (Array.isArray(provided)) return 'invalid';
  if (!provided) return 'missing';
  return safeEqual(provided, expected) ? 'ok' : 'invalid';
}
