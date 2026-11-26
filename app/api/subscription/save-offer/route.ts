import { NextResponse } from 'next/server';

import { stripe } from '@/lib/stripe';
import {
  ensureSaveOnceCoupon,
  requireOwnedSubscription,
  subscriptionSummary,
} from '@/lib/subscription-save';
import {
  SAVE_OFFER_USED_KEY,
  isCancelFeedback,
  saveOfferEligibility,
} from '@/lib/stripe-subscription';
import { AnalyticsEvents } from '@/lib/analytics/events';
import {
  captureServerEventAfterResponse,
  captureServerExceptionAfterResponse,
} from '@/lib/posthog-server';

const REFUSALS = {
  already_used: 'This offer was already used on your subscription',
  has_discount: 'A discount is already applied to this subscription',
  paused: 'Resume the subscription before applying a discount',
} as const;

/**
 * The cancel flow's save step (components/subscription/cancel-dialog.tsx):
 * 50% off the next invoice (`octree_save50_once`, duration once) on the
 * user's own live subscription, once per subscription. Refused with 409 when
 * the subscription already used it (`metadata.save_offer_once_used`), has
 * any other discount, or is paused. Taking it turns renewal back on.
 *
 * Body (optional): `{ feedback }`, the cancel reason that led here, for
 * `cancel_save_offer_accepted`.
 */
export async function POST(request: Request) {
  try {
    let body: { feedback?: unknown } = {};
    try {
      body = await request.json();
    } catch {
      body = {};
    }
    const feedback = isCancelFeedback(body.feedback) ? body.feedback : undefined;

    const owned = await requireOwnedSubscription();
    if (!owned.ok) return owned.response;
    const { user, subscription } = owned.value;

    const eligibility = saveOfferEligibility(subscription);
    if (eligibility !== 'eligible') {
      return NextResponse.json({ error: REFUSALS[eligibility], reason: eligibility }, { status: 409 });
    }

    const coupon = await ensureSaveOnceCoupon();
    const saved = await stripe.subscriptions.update(subscription.id, {
      discounts: [{ coupon: coupon.id }],
      cancel_at_period_end: false,
      // Metadata merges by key: user_id (the webhook needs it) is kept.
      metadata: { [SAVE_OFFER_USED_KEY]: new Date().toISOString() },
    });

    captureServerEventAfterResponse(user.id, AnalyticsEvents.CANCEL_SAVE_OFFER_ACCEPTED, {
      offer: 'discount_once',
      ...(feedback ? { feedback } : {}),
    });

    return NextResponse.json({
      success: true,
      coupon: { id: coupon.id, percent_off: coupon.percent_off, duration: coupon.duration },
      subscription: subscriptionSummary(saved),
    });
  } catch (error) {
    console.error('Error applying the save offer:', error);
    captureServerExceptionAfterResponse(error, { route: 'api/subscription/save-offer' });
    return NextResponse.json({ error: 'Failed to apply the offer' }, { status: 500 });
  }
}
