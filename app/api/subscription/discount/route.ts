import { NextResponse } from 'next/server';

import { stripe } from '@/lib/stripe';
import {
  ensureSaveCoupon,
  requireOwnedSubscription,
  subscriptionSummary,
} from '@/lib/subscription-save';
import { SAVE_DISCOUNT_USED_KEY, saveDiscountEligibility } from '@/lib/stripe-subscription';

const REFUSALS = {
  already_used: 'A discount is already applied to this subscription',
  other_offer_used: 'A save discount was already used on your subscription',
  has_discount: 'A discount is already applied to this subscription',
  paused: 'Resume the subscription before applying a discount',
} as const;
import { AnalyticsEvents } from '@/lib/analytics/events';
import {
  captureServerEventAfterResponse,
  captureServerExceptionAfterResponse,
} from '@/lib/posthog-server';

/**
 * Applies the save coupon (50% off, next 2 months) to the user's live
 * subscription, once (`metadata.save_discount_used`; refused too once the
 * save step's 50%-off-once was used, `save_offer_once_used`). A subscription that already carries any discount is
 * refused with 409 so the offer cannot be stacked or re-taken; Stripe also
 * drops the coupon when the subscription is cancelled, so a resubscribe is a
 * fresh subscription with no discount. Taking the offer also turns renewal
 * back on if it had been switched off.
 */
export async function POST() {
  try {
    const owned = await requireOwnedSubscription();
    if (!owned.ok) return owned.response;
    const { user, subscription } = owned.value;

    const eligibility = saveDiscountEligibility(subscription);
    if (eligibility !== 'eligible') {
      return NextResponse.json({ error: REFUSALS[eligibility], reason: eligibility }, { status: 409 });
    }

    const coupon = await ensureSaveCoupon();
    const discounted = await stripe.subscriptions.update(subscription.id, {
      discounts: [{ coupon: coupon.id }],
      cancel_at_period_end: false,
      // Never again on this subscription, nor the save step's discount
      // (metadata merges by key: user_id is kept).
      metadata: { [SAVE_DISCOUNT_USED_KEY]: new Date().toISOString() },
    });

    captureServerEventAfterResponse(user.id, AnalyticsEvents.CANCEL_OFFER_ACCEPTED, {
      offer: 'discount',
    });

    return NextResponse.json({
      success: true,
      coupon: {
        id: coupon.id,
        percent_off: coupon.percent_off,
        duration_in_months: coupon.duration_in_months,
      },
      subscription: subscriptionSummary(discounted),
    });
  } catch (error) {
    console.error('Error applying discount:', error);
    captureServerExceptionAfterResponse(error, { route: 'api/subscription/discount' });
    return NextResponse.json({ error: 'Failed to apply discount' }, { status: 500 });
  }
}
