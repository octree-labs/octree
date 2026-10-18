import type Stripe from 'stripe';

import type { CancelFeedback } from '@/lib/analytics/events';

/**
 * Pure helpers shared by the save-offer routes, the Stripe webhook and the
 * subscription-status route. No Stripe client here, so the webhook can import
 * this without the `lib/stripe` singleton.
 *
 * Pausing: `pause_collection` (behavior `void`) leaves the Stripe status at
 * `active` and voids each invoice until `resumes_at`. The app treats that
 * window as the free tier: `effectiveSubscriptionStatus` reports `paused`, and
 * both writers of `user_usage` (webhook, subscription-status RPC) derive
 * `is_pro` from the effective status, so Pro switches off on pause and back on
 * when Stripe clears the pause (which fires `customer.subscription.updated`).
 */

export const SAVE_COUPON_ID = 'save50-2mo';
export const SAVE_COUPON_PERCENT_OFF = 50;
export const SAVE_COUPON_MONTHS = 2;

export const PAUSE_MONTH_OPTIONS = [1, 2, 3] as const;
export type PauseMonths = (typeof PAUSE_MONTH_OPTIONS)[number];

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
  Partial<Pick<Stripe.Subscription, 'pause_collection' | 'discount' | 'discounts'>>;

export function isPauseMonths(value: unknown): value is PauseMonths {
  return (PAUSE_MONTH_OPTIONS as readonly number[]).includes(value as number);
}

export function isCancelFeedback(value: unknown): value is CancelFeedback {
  return typeof value === 'string' && (CANCEL_FEEDBACK_VALUES as readonly string[]).includes(value);
}

export function isSubscriptionPaused(subscription: SubscriptionLike): boolean {
  return Boolean(subscription.pause_collection);
}

/** When Stripe will clear the pause, in unix seconds; null when not paused or open-ended. */
export function pauseResumesAt(subscription: SubscriptionLike): number | null {
  return subscription.pause_collection?.resumes_at ?? null;
}

/**
 * The status `user_usage.subscription_status` / `is_pro` are derived from.
 * A paused subscription is `active` to Stripe but `paused` to the app.
 */
export function effectiveSubscriptionStatus(
  subscription: SubscriptionLike
): Stripe.Subscription.Status | 'paused' {
  const { status } = subscription;
  if ((status === 'active' || status === 'trialing') && isSubscriptionPaused(subscription)) {
    return 'paused';
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

/** `resumes_at` for a pause of `months` calendar months from `now`, in unix seconds. */
export function pauseResumeTimestamp(months: PauseMonths, now: Date = new Date()): number {
  const resume = new Date(now.getTime());
  resume.setUTCMonth(resume.getUTCMonth() + months);
  return Math.floor(resume.getTime() / 1000);
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
    current_period_end: subscription.current_period_end,
    paused_until: pauseResumesAt(subscription),
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
