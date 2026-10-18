import { NextResponse } from 'next/server';

import { stripe } from '@/lib/stripe';
import { requireOwnedSubscription, subscriptionSummary } from '@/lib/subscription-save';
import { PAUSE_PAID_THROUGH_KEY, isSubscriptionPaused } from '@/lib/stripe-subscription';
import { AnalyticsEvents } from '@/lib/analytics/events';
import {
  captureServerEventAfterResponse,
  captureServerExceptionAfterResponse,
} from '@/lib/posthog-server';

/**
 * Clears `pause_collection` so the next invoice is collected again. The
 * webhook for the resulting `customer.subscription.updated` turns `is_pro`
 * back on. Idempotent: an unpaused subscription is returned as is.
 */
export async function POST() {
  try {
    const owned = await requireOwnedSubscription();
    if (!owned.ok) return owned.response;
    const { user, subscription } = owned.value;

    if (!isSubscriptionPaused(subscription)) {
      return NextResponse.json({
        success: true,
        alreadyActive: true,
        subscription: subscriptionSummary(subscription),
      });
    }

    const resumed = await stripe.subscriptions.update(subscription.id, {
      pause_collection: '',
      // Drop the paid-through marker the pause route wrote (null deletes the key).
      metadata: { [PAUSE_PAID_THROUGH_KEY]: null },
    });

    captureServerEventAfterResponse(user.id, AnalyticsEvents.SUBSCRIPTION_RESUMED, {
      source: 'user',
    });

    return NextResponse.json({
      success: true,
      alreadyActive: false,
      subscription: subscriptionSummary(resumed),
    });
  } catch (error) {
    console.error('Error resuming subscription:', error);
    captureServerExceptionAfterResponse(error, { route: 'api/subscription/resume' });
    return NextResponse.json({ error: 'Failed to resume subscription' }, { status: 500 });
  }
}
