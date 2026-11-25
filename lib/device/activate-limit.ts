import { createRateLimiter } from '@/lib/import/rate-limit';

/**
 * Code lookups and decisions on /activate, per signed-in user: 30 per 10
 * minutes (per process). Together with the 2^34.6 user-code space and the
 * 15-minute lifetime this makes guessing someone else's live code useless.
 */
const globalForActivate = globalThis as unknown as {
  __octreeActivateLimiter__?: ReturnType<typeof createRateLimiter>;
};
const limiter = (globalForActivate.__octreeActivateLimiter__ ??= createRateLimiter({
  limit: 30,
  windowMs: 10 * 60_000,
}));

export function allowActivateAttempt(userId: string, now = Date.now()): boolean {
  return limiter.check(userId, now).allowed;
}
