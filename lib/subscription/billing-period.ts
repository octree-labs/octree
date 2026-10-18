/**
 * When does a subscription write reset the Pro monthly edit counter?
 *
 * Both writers of user_usage billing columns (the Stripe webhook and
 * GET /api/subscription-status through the update_user_subscription_status
 * RPC) used to zero `monthly_edit_count` on every write while the
 * subscription was active. The status route runs on every page load, so Pro
 * counters never got past 0 and the 500/month cap was never enforced. The
 * counter now resets only when a new billing period starts; a write that
 * carries the same period keeps it. The RPC applies the same rule in SQL
 * (supabase/migrations/20261018140000_subscription_status_keeps_monthly_count.sql).
 */

export interface StoredBillingRow {
  is_pro: boolean | null;
  stripe_customer_id?: string | null;
  stripe_subscription_id: string | null;
  subscription_status?: string | null;
  current_period_start: string | null;
  current_period_end?: string | null;
  cancel_at_period_end?: boolean | null;
}

export interface IncomingSubscription {
  customerId: string;
  subscriptionId: string;
  /** Effective status (`paused` while collection is paused), not Stripe's raw status. */
  status: string;
  /** Whether `status` grants Pro. */
  isPro: boolean;
  /** ISO timestamps; null when Stripe did not send them. */
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
}

function toMs(value: string | null | undefined): number | null {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * True when `incoming` opens a billing period the stored row has not seen:
 * the first activation, a different subscription, or `current_period_start`
 * moving forward (a renewal). False for every other write, including a
 * status read that repeats the current period, a cancel_at_period_end
 * toggle, a discount or a pause within the period.
 */
export function startsNewBillingPeriod(
  stored: StoredBillingRow | null | undefined,
  incoming: IncomingSubscription
): boolean {
  if (!incoming.isPro) return false;
  if (!stored || !stored.is_pro) return true;
  if (stored.stripe_subscription_id !== incoming.subscriptionId) return true;

  const storedStart = toMs(stored.current_period_start);
  const incomingStart = toMs(incoming.currentPeriodStart);
  if (storedStart === null) return true;
  if (incomingStart === null) return false;
  return incomingStart > storedStart;
}

/**
 * True when the stored row already holds exactly what `incoming` would
 * write, so the writer can skip the round trip. Used by the status route,
 * which otherwise rewrites the same billing columns on every page load.
 */
export function billingRowMatches(
  stored: StoredBillingRow | null | undefined,
  incoming: IncomingSubscription
): boolean {
  if (!stored) return false;
  return (
    Boolean(stored.is_pro) === incoming.isPro &&
    (stored.stripe_customer_id ?? null) === incoming.customerId &&
    stored.stripe_subscription_id === incoming.subscriptionId &&
    (stored.subscription_status ?? null) === incoming.status &&
    Boolean(stored.cancel_at_period_end) === incoming.cancelAtPeriodEnd &&
    toMs(stored.current_period_start) === toMs(incoming.currentPeriodStart) &&
    toMs(stored.current_period_end) === toMs(incoming.currentPeriodEnd)
  );
}

/**
 * The day the monthly counter next resets on its own (the lazy reset in
 * increment_edit_count and the usage routes): the billing date when Stripe
 * sent one, else 30 days out as before.
 */
export function monthlyResetDateFor(currentPeriodEnd: string | null, now: Date = new Date()): string {
  const endMs = toMs(currentPeriodEnd);
  const date = endMs !== null && endMs > now.getTime() ? new Date(endMs) : new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
  return date.toISOString().split('T')[0];
}
