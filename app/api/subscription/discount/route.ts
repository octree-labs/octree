import { NextResponse } from 'next/server';

import { stripe } from '@/lib/stripe';
import {
  ensureSaveCoupon,
  requireOwnedSubscription,
  subscriptionSummary,
} from '@/lib/subscription-save';
import {
  isSubscriptionPaused,
  subscriptionHasDiscount,
} from '@/lib/stripe-subscription';
import { AnalyticsEvents } from '@/lib/analytics/events';
import {
  captureServerEventAfterResponse,
  captureServerExceptionAfterResponse,
} from '@/lib/posthog-server';

/**
 * Applies the save coupon (50% off, next 2 months) to the user's live
 * subscription, once. A subscription that already carries any discount is
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

    if (subscriptionHasDiscount(subscription)) {
      return NextResponse.json(
        { error: 'A discount is already applied to this subscription' },
        { status: 409 }
      );
    }
    if (isSubscriptionPaused(subscription)) {
      return NextResponse.json(
        { error: 'Resume the subscription before applying a discount' },
        { status: 409 }
      );
    }

    const coupon = await ensureSaveCoupon();
    const discounted = await stripe.subscriptions.update(subscription.id, {
      discounts: [{ coupon: coupon.id }],
      cancel_at_period_end: false,
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
