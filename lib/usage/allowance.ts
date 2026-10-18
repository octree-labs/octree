import { FREE_DAILY_EDIT_LIMIT, PRO_MONTHLY_EDIT_LIMIT } from '@/data/constants';

/**
 * Which pool an AI edit comes out of. Pure, so the ordering is unit tested:
 *
 * | tier | allowance left | credits > 0 | decision  |
 * |------|----------------|-------------|-----------|
 * | free | yes            | any         | `free`    |
 * | free | no             | yes         | `credit`  |
 * | free | no             | no          | `blocked` |
 * | pro  | yes            | any         | `pro`     |
 * | pro  | no             | yes         | `credit`  |
 * | pro  | no             | no          | `blocked` |
 *
 * Purchased credits never expire and are only touched once the free daily
 * allowance (5/day) or the Pro monthly allowance (500/month) is spent. A
 * reset date in the past counts as a fresh allowance: the caller's
 * increment RPC performs the actual reset.
 */

export type AllowanceDecision = 'free' | 'pro' | 'credit' | 'blocked';

export interface AllowanceUsage {
  edit_count: number | null | undefined;
  monthly_edit_count: number | null | undefined;
  edit_credits?: number | null | undefined;
  /** ISO date (YYYY-MM-DD); the day the free counter was last reset. */
  daily_reset_date?: string | null | undefined;
  /** ISO date; when the Pro counter resets. */
  monthly_reset_date?: string | null | undefined;
}

export function dailyAllowanceResets(dailyResetDate: string | null | undefined, now: Date): boolean {
  if (!dailyResetDate) return false;
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const reset = new Date(dailyResetDate + 'T00:00:00');
  return !Number.isNaN(reset.getTime()) && today > reset;
}

export function monthlyAllowanceResets(monthlyResetDate: string | null | undefined, now: Date): boolean {
  if (!monthlyResetDate) return false;
  const reset = new Date(monthlyResetDate);
  return !Number.isNaN(reset.getTime()) && now >= reset;
}

/** Edits left in the plan allowance (ignores credits), after any due reset. */
export function remainingAllowance(usage: AllowanceUsage, isPro: boolean, now: Date = new Date()): number {
  if (isPro) {
    const used = monthlyAllowanceResets(usage.monthly_reset_date, now)
      ? 0
      : usage.monthly_edit_count ?? 0;
    return Math.max(0, PRO_MONTHLY_EDIT_LIMIT - used);
  }
  const used = dailyAllowanceResets(usage.daily_reset_date, now) ? 0 : usage.edit_count ?? 0;
  return Math.max(0, FREE_DAILY_EDIT_LIMIT - used);
}

export function decideAllowance(
  usage: AllowanceUsage,
  isPro: boolean,
  now: Date = new Date()
): AllowanceDecision {
  if (remainingAllowance(usage, isPro, now) > 0) return isPro ? 'pro' : 'free';
  if ((usage.edit_credits ?? 0) > 0) return 'credit';
  return 'blocked';
}

/** The 429 body text when nothing is left; mentions the credit pack. */
export function limitReachedMessage(isPro: boolean): string {
  return isPro
    ? `You've reached your monthly limit of ${PRO_MONTHLY_EDIT_LIMIT} edits. Your limit resets on your billing date, or buy 100 edits for $5 to keep going.`
    : `You've reached your daily limit of ${FREE_DAILY_EDIT_LIMIT} edits. Upgrade to Pro for ${PRO_MONTHLY_EDIT_LIMIT} edits per month, or buy 100 edits for $5.`;
}
