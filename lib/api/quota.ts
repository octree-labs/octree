import { API_FREE_DAILY_COMPILES, API_PRO_DAILY_COMPILES } from '@/data/constants';

/**
 * Daily compile quota of the public API (`api_usage_daily`, incremented by
 * the service-role-only `increment_api_usage` RPC). Days are UTC; the quota
 * resets at 00:00 UTC.
 */

export const API_UPGRADE_URL = 'https://app.useoctree.com/pricing?from=api';

export type ApiPlan = 'free' | 'pro';

export function dailyLimitFor(plan: ApiPlan): number {
  return plan === 'pro' ? API_PRO_DAILY_COMPILES : API_FREE_DAILY_COMPILES;
}

/** `YYYY-MM-DD` of `now` in UTC: the `api_usage_daily.day` key. */
export function utcDay(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/** ISO timestamp of the next 00:00 UTC, when today's count resets. */
export function quotaResetsAt(now: Date = new Date()): string {
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
  return next.toISOString();
}

export interface QuotaExceededBody {
  error: 'quota_exceeded';
  message: string;
  limit: number;
  used: number;
  resets_at: string;
  upgrade_url: string;
}

export type QuotaDecision =
  | { allowed: true; used: number; limit: number }
  | { allowed: false; body: QuotaExceededBody };

/**
 * Decides on a compile from the count `increment_api_usage` returned (the
 * count including this request). Requests over the limit are refused; the
 * reported `used` never exceeds the limit, since refused requests did not
 * compile anything.
 */
export function decideQuota(countAfterIncrement: number, plan: ApiPlan, now: Date = new Date()): QuotaDecision {
  const limit = dailyLimitFor(plan);
  if (countAfterIncrement <= limit) return { allowed: true, used: countAfterIncrement, limit };
  return {
    allowed: false,
    body: {
      error: 'quota_exceeded',
      message:
        plan === 'pro'
          ? `Daily API compile limit of ${limit} reached. It resets at 00:00 UTC.`
          : `Daily API compile limit of ${limit} reached on the free plan. Upgrade to Pro for ${API_PRO_DAILY_COMPILES} compiles a day.`,
      limit,
      used: limit,
      resets_at: quotaResetsAt(now),
      upgrade_url: API_UPGRADE_URL,
    },
  };
}

/** Seconds until the reset, for `Retry-After`. */
export function secondsUntilReset(now: Date = new Date()): number {
  return Math.max(1, Math.ceil((Date.parse(quotaResetsAt(now)) - now.getTime()) / 1000));
}

/** `used_today` for GET /api/v1/me: refused requests beyond the limit are not compiles. */
export function usedToday(count: number | null | undefined, plan: ApiPlan): number {
  return Math.min(Math.max(0, count ?? 0), dailyLimitFor(plan));
}
