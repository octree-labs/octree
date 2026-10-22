import type Stripe from 'stripe';

import type { CancelFeedback } from '@/lib/analytics/events';

/**
 * Pure helpers shared by the save-offer routes, the Stripe webhook and the
 * subscription-status route. No Stripe client here, so the webhook can import
 * this without the `lib/stripe` singleton.
 *
 * Pausing: `pause_collection` (behavior `void`) leaves the Stripe status at
 * `active`, keeps the billing cycle turning and voids each invoice until
 * `resumes_at`. The user has already paid for the current period, so Pro
 * stays on until that period ends (`metadata.pause_paid_through`, written by
 * the pause route); from then until `resumes_at` the app treats the
 * subscription as the free tier: `effectiveSubscriptionStatus` reports
 * `paused`, and both writers of `user_usage` (webhook, subscription-status
 * RPC) derive `is_pro` from the effective status. Stripe sends
 * `customer.subscription.updated` when the paid period rolls over (the voided
 * invoice) and again when it clears the pause, so the webhook sees both
 * transitions; the subscription-status route recomputes on every load too.
 */

export const SAVE_COUPON_ID = 'save50-2mo';
export const SAVE_COUPON_PERCENT_OFF = 50;
export const SAVE_COUPON_MONTHS = 2;

export const PAUSE_MONTH_OPTIONS = [1, 2, 3] as const;
export type PauseMonths = (typeof PAUSE_MONTH_OPTIONS)[number];

/**
 * Subscription metadata key: unix seconds until which the customer has paid
 * (the `current_period_end` at the moment of pausing). Pro stays on until then.
 */
export const PAUSE_PAID_THROUGH_KEY = 'pause_paid_through';

export const CANCEL_FEEDBACK_VALUES: readonly CancelFeedback[] = [
  'unused',
  'too_expensive',
  'missing_features',
  'low_quality',
  'switched_service',
  'other',
];

export const CANCEL_COMMENT_MAX_LENGTH = 500;

export type SubscriptionLike = Pick<Stripe.Subscription, 'status'> &
  Partial<Pick<Stripe.Subscription, 'pause_collection' | 'discount' | 'discounts' | 'metadata'>>;

export function isPauseMonths(value: unknown): value is PauseMonths {
  return (PAUSE_MONTH_OPTIONS as readonly number[]).includes(value as number);
}

export function isCancelFeedback(value: unknown): value is CancelFeedback {
  return typeof value === 'string' && (CANCEL_FEEDBACK_VALUES as readonly string[]).includes(value);
}

/** True when collection is paused, whether or not the paid period has ended yet. */
export function isSubscriptionPaused(subscription: SubscriptionLike): boolean {
  return Boolean(subscription.pause_collection);
}

/** When Stripe will clear the pause, in unix seconds; null when not paused or open-ended. */
export function pauseResumesAt(subscription: SubscriptionLike): number | null {
  return subscription.pause_collection?.resumes_at ?? null;
}

/**
 * Until when the paused customer keeps Pro (unix seconds), from the metadata
 * the pause route writes. Null when not paused, or when the pause was set
 * elsewhere (Stripe dashboard) and the free tier applies at once.
 */
export function pausePaidThrough(subscription: SubscriptionLike): number | null {
  if (!isSubscriptionPaused(subscription)) return null;
  const raw = subscription.metadata?.[PAUSE_PAID_THROUGH_KEY];
  if (raw == null || raw === '') return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : null;
}

/**
 * The status `user_usage.subscription_status` / `is_pro` are derived from.
 * A paused subscription is `active` to Stripe but `paused` to the app once
 * the period the customer already paid for has ended.
 */
export function effectiveSubscriptionStatus(
  subscription: SubscriptionLike,
  nowSeconds: number = Math.floor(Date.now() / 1000)
): Stripe.Subscription.Status | 'paused' {
  const { status } = subscription;
  if ((status === 'active' || status === 'trialing') && isSubscriptionPaused(subscription)) {
    const paidThrough = pausePaidThrough(subscription);
    if (paidThrough == null || nowSeconds >= paidThrough) return 'paused';
  }
  return status;
}

export function isProStatus(status: string): boolean {
  return status === 'active' || status === 'trialing';
}

/**
 * True when any discount is attached. `discounts` is the current field;
 * `discount` is the deprecated single-discount view older API versions fill.
 */
export function subscriptionHasDiscount(subscription: SubscriptionLike): boolean {
  if (subscription.discounts && subscription.discounts.length > 0) return true;
  return Boolean(subscription.discount);
}

/** The coupon id of the save discount when it is the one applied, else null. */
export function appliedCouponId(subscription: SubscriptionLike): string | null {
  const first = subscription.discounts?.[0];
  if (first && typeof first !== 'string') return first.coupon?.id ?? null;
  return subscription.discount?.coupon?.id ?? null;
}

/**
 * `resumes_at` for a pause of `months` calendar months after `from` (the end
 * of the paid period), in unix seconds, computed in UTC. A day the target
 * month does not have is clamped to its last day (Jan 31 + 1 month = Feb 28,
 * or Feb 29 in a leap year) instead of spilling into the month after.
 */
export function pauseResumeTimestamp(months: PauseMonths, from: Date): number {
  const year = from.getUTCFullYear();
  const month = from.getUTCMonth() + months;
  const lastDayOfTarget = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const day = Math.min(from.getUTCDate(), lastDayOfTarget);
  const resume = Date.UTC(
    year,
    month,
    day,
    from.getUTCHours(),
    from.getUTCMinutes(),
    from.getUTCSeconds()
  );
  return Math.floor(resume / 1000);
}

export function trimCancelComment(comment: unknown): string | undefined {
  if (typeof comment !== 'string') return undefined;
  const trimmed = comment.trim();
  if (!trimmed) return undefined;
  return trimmed.slice(0, CANCEL_COMMENT_MAX_LENGTH);
}

/** The subscription fields the cancel dialog and the status card render. */
export interface SubscriptionOfferState {
  id: string;
  status: Stripe.Subscription.Status;
  effective_status: Stripe.Subscription.Status | 'paused';
  cancel_at_period_end: boolean;
  current_period_end: number;
  paused_until: number | null;
  /** While paused: unix seconds until which Pro stays on; null when not paused. */
  pause_paid_through: number | null;
  has_discount: boolean;
  /** Only the save coupon can be offered; another discount also blocks it. */
  discount_coupon_id: string | null;
  price: {
    unit_amount: number | null;
    currency: string;
    interval: string | null;
  } | null;
}

export function describeSubscriptionOffers(subscription: Stripe.Subscription): SubscriptionOfferState {
  const price = subscription.items?.data?.[0]?.price;
  return {
    id: subscription.id,
    status: subscription.status,
    effective_status: effectiveSubscriptionStatus(subscription),
    cancel_at_period_end: subscription.cancel_at_period_end,
    // The dialog renders it as a date; an active subscription always has one.
    current_period_end: subscriptionPeriod(subscription).end ?? subscription.current_period_end,
    paused_until: pauseResumesAt(subscription),
    pause_paid_through: pausePaidThrough(subscription),
    has_discount: subscriptionHasDiscount(subscription),
    discount_coupon_id: appliedCouponId(subscription),
    price: price
      ? {
          unit_amount: price.unit_amount,
          currency: price.currency,
          interval: price.recurring?.interval ?? null,
        }
      : null,
  };
}

export interface PriceIntervalLike {
  interval: string | null | undefined;
  interval_count?: number | null | undefined;
}

export type PlanKind = 'monthly' | 'annual' | 'semester' | 'weekly' | 'other';

/** Which plan a recurring price interval is, for display. */
export function planKindFromInterval(recurring: PriceIntervalLike | null | undefined): PlanKind {
  if (!recurring?.interval) return 'other';
  const count = recurring.interval_count ?? 1;
  if (recurring.interval === 'year' && count === 1) return 'annual';
  if (recurring.interval === 'month' && count === 4) return 'semester';
  if (recurring.interval === 'month' && count === 1) return 'monthly';
  if (recurring.interval === 'week' && count === 1) return 'weekly';
  return 'other';
}

/**
 * The status card's one-line plan description, e.g. "Annual, renews 1/2/2027"
 * or "Semester pass until 1/2/2027". `cancelAtPeriodEnd` turns "renews" into
 * "ends".
 */
export function describePlanPeriod(
  recurring: PriceIntervalLike | null | undefined,
  periodEnd: Date,
  cancelAtPeriodEnd: boolean,
  formatDate: (d: Date) => string = (d) => d.toLocaleDateString()
): string {
  const when = formatDate(periodEnd);
  const verb = cancelAtPeriodEnd ? 'ends' : 'renews';
  switch (planKindFromInterval(recurring)) {
    case 'annual':
      return `Annual, ${verb} ${when}`;
    case 'semester':
      return cancelAtPeriodEnd ? `Semester pass until ${when}` : `Semester pass until ${when}, then renews`;
    case 'monthly':
      return `Monthly, ${verb} ${when}`;
    case 'weekly':
      return `Weekly (legacy plan), ${verb} ${when}`;
    default:
      return `${verb.charAt(0).toUpperCase() + verb.slice(1)} ${when}`;
  }
}

/**
 * The fields `subscriptionPeriod` reads. Structural so it accepts a
 * `Stripe.Subscription` from any SDK version and a raw webhook payload.
 */
export interface StripePeriodSource {
  current_period_start?: number | null;
  current_period_end?: number | null;
  /**
   * Each item may carry `current_period_start` / `current_period_end`
   * (`StripePeriodItem`). Typed `unknown` because the SDK's own item type
   * (acacia) does not declare them yet.
   */
  items?: { data?: ReadonlyArray<unknown> | null } | null;
}

/** The period fields of a subscription item (API 2025-03-31.basil and later). */
export interface StripePeriodItem {
  current_period_start?: number | null;
  current_period_end?: number | null;
}

/** A subscription's current billing period in Unix seconds; null when Stripe did not send it. */
export interface SubscriptionPeriod {
  start: number | null;
  end: number | null;
}

function unixSeconds(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

/**
 * The current billing period of a Stripe subscription, whatever API version
 * rendered it.
 *
 * Up to API version 2025-02-24.acacia (the version the SDK in this repo is
 * pinned to) `current_period_start` / `current_period_end` sit on the
 * Subscription. From 2025-03-31.basil on they moved to each subscription
 * item (`items.data[i].current_period_*`), and the top-level fields are
 * gone. Webhook payloads are rendered in the endpoint's API version (ours is
 * newer than the SDK's), so the webhook sees the item shape while SDK reads
 * still see the top-level one.
 *
 * Rule, per field: the top-level value when it is a number; otherwise the
 * value on the first item that carries both start and end; otherwise null.
 * Start and end always come from the same item, so the pair is one real
 * period. Octree subscriptions have exactly one item (checked against every
 * subscription on the account, Oct 2026). Items of one subscription can only
 * have different periods under `billing_mode: flexible` with mixed
 * intervals, which Octree never creates; if it ever does, the monthly
 * counter reset follows the cycle of the first item in `items.data`.
 */
export function subscriptionPeriod(subscription: StripePeriodSource | null | undefined): SubscriptionPeriod {
  if (!subscription) return { start: null, end: null };
  const items = (subscription.items?.data ?? []) as ReadonlyArray<StripePeriodItem | null | undefined>;
  const item = items.find(
    (candidate) =>
      unixSeconds(candidate?.current_period_start) !== null && unixSeconds(candidate?.current_period_end) !== null
  );
  return {
    start: unixSeconds(subscription.current_period_start) ?? unixSeconds(item?.current_period_start),
    end: unixSeconds(subscription.current_period_end) ?? unixSeconds(item?.current_period_end),
  };
}

/** `subscriptionPeriod` as ISO timestamps (the format of the `user_usage` columns). */
export function subscriptionPeriodIso(
  subscription: StripePeriodSource | null | undefined
): { start: string | null; end: string | null } {
  const { start, end } = subscriptionPeriod(subscription);
  return {
    start: start === null ? null : new Date(start * 1000).toISOString(),
    end: end === null ? null : new Date(end * 1000).toISOString(),
  };
}
