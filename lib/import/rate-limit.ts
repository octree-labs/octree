/**
 * Tiny in-memory sliding-window limiter for the guest preview route.
 *
 * It is per process: on Vercel Fluid Compute one instance serves many
 * requests, so it does throttle a single abusive client, but a burst spread
 * over several instances (or a cold start) resets the count. That is fine
 * here: the limiter only protects the compile service from a loop hammering
 * one IP, and the storage cache already makes repeated hits for the same
 * draft free.
 */

export interface RateLimitDecision {
  allowed: boolean;
  /** Seconds until the oldest hit in the window falls out (0 when allowed). */
  retryAfterSeconds: number;
  remaining: number;
}

export interface RateLimiter {
  check(key: string, now?: number): RateLimitDecision;
  /** Number of keys currently tracked (for tests). */
  size(): number;
}

export interface RateLimiterOptions {
  limit: number;
  windowMs: number;
  /** Oldest keys are dropped past this many entries so the map cannot grow unbounded. */
  maxKeys?: number;
}

export function createRateLimiter({ limit, windowMs, maxKeys = 10_000 }: RateLimiterOptions): RateLimiter {
  const hits = new Map<string, number[]>();

  function prune(key: string, now: number): number[] {
    const cutoff = now - windowMs;
    const kept = (hits.get(key) ?? []).filter((t) => t > cutoff);
    if (kept.length === 0) hits.delete(key);
    else hits.set(key, kept);
    return kept;
  }

  return {
    check(key, now = Date.now()) {
      const recent = prune(key, now);
      if (recent.length >= limit) {
        const retryAfterMs = recent[0] + windowMs - now;
        return {
          allowed: false,
          retryAfterSeconds: Math.max(1, Math.ceil(retryAfterMs / 1000)),
          remaining: 0,
        };
      }

      // Re-insert so the key moves to the end: Map iteration is insertion
      // order, which makes the first key the least recently used one.
      hits.delete(key);
      hits.set(key, [...recent, now]);
      while (hits.size > maxKeys) {
        const oldest = hits.keys().next().value;
        if (oldest === undefined) break;
        hits.delete(oldest);
      }

      return { allowed: true, retryAfterSeconds: 0, remaining: limit - recent.length - 1 };
    },
    size() {
      return hits.size;
    },
  };
}

/** First hop of `x-forwarded-for` (set by Vercel), else `x-real-ip`, else a shared bucket. */
export function clientIp(headers: Headers): string {
  const forwarded = headers.get('x-forwarded-for');
  const first = forwarded?.split(',')[0]?.trim();
  if (first) return first;
  return headers.get('x-real-ip')?.trim() || 'unknown';
}
