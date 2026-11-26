/**
 * Deadline Pass rules for app/api/checkout-session. Pure, so they are unit
 * tested without Stripe or Supabase.
 */

/** The user_usage columns the checkout reads for them. */
export interface BillingRow {
  subscription_status: string | null;
  stripe_subscription_id: string | null;
  current_period_end: string | null;
  pro_until: string | null;
}

/**
 * An active or trialing subscription whose period has not ended: the only
 * state in which a Deadline Pass would buy nothing. A failed renewal
 * (past_due, unpaid, incomplete) or a stale `is_pro` does not count.
 */
export function hasLiveSubscription(row: BillingRow | null | undefined, now: Date = new Date()): boolean {
  if (!row?.stripe_subscription_id) return false;
  if (row.subscription_status !== 'active' && row.subscription_status !== 'trialing') return false;
  const end = row.current_period_end ? Date.parse(row.current_period_end) : NaN;
  return !Number.isFinite(end) || end > now.getTime();
}

/** Stripe refuses a `trial_end` less than 48 hours out. */
export const MIN_PASS_TRIAL_MS = 48 * 60 * 60 * 1000;

/**
 * `subscription_data.trial_end` (unix seconds) for a subscription bought
 * while a Deadline Pass runs: the pass end, so billing starts when the pass
 * ends. Null when there is no pass or it ends within 48 hours (billing then
 * starts today, and the settings copy says so).
 */
export function passTrialEnd(proUntil: string | null | undefined, now: Date = new Date()): number | null {
  if (!proUntil) return null;
  const end = Date.parse(proUntil);
  if (!Number.isFinite(end) || end - now.getTime() <= MIN_PASS_TRIAL_MS) return null;
  return Math.floor(end / 1000);
}
