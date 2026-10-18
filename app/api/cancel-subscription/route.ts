import { NextResponse } from 'next/server';

import { stripe } from '@/lib/stripe';
import { requireOwnedSubscription, subscriptionSummary } from '@/lib/subscription-save';
import { isCancelFeedback, trimCancelComment } from '@/lib/stripe-subscription';
import { AnalyticsEvents } from '@/lib/analytics/events';
import {
  captureServerEventAfterResponse,
  captureServerExceptionAfterResponse,
} from '@/lib/posthog-server';

/**
 * Turns renewal off at the end of the current period, recording why on the
 * Stripe subscription (`cancellation_details`). The reason is required: the
 * cancel dialog collects it before the button is enabled. Idempotent: a
 * subscription whose renewal is already off is returned as is.
 */
export async function POST(request: Request) {
  try {
    let body: { feedback?: unknown; comment?: unknown } = {};
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }
    const { feedback } = body;
    if (!isCancelFeedback(feedback)) {
      return NextResponse.json({ error: 'A cancellation reason is required' }, { status: 400 });
    }
    const comment = trimCancelComment(body.comment);

    const owned = await requireOwnedSubscription();
    if (!owned.ok) return owned.response;
    const { user, subscription } = owned.value;

    if (subscription.cancel_at_period_end) {
      return NextResponse.json({
        success: true,
        alreadyCanceled: true,
        subscription: subscriptionSummary(subscription),
      });
    }

    // Cancel the subscription at the end of the current period
    const canceledSubscription = await stripe.subscriptions.update(subscription.id, {
      cancel_at_period_end: true,
      cancellation_details: { feedback, ...(comment ? { comment } : {}) },
    });

    captureServerEventAfterResponse(user.id, AnalyticsEvents.SUBSCRIPTION_CANCEL_CONFIRMED, {
      feedback,
      has_comment: Boolean(comment),
    });

    return NextResponse.json({
      success: true,
      alreadyCanceled: false,
      subscription: subscriptionSummary(canceledSubscription),
    });
  } catch (error) {
    console.error('Error canceling subscription:', error);
    captureServerExceptionAfterResponse(error, { route: 'api/cancel-subscription' });
    return NextResponse.json(
      { error: 'Failed to cancel subscription' },
      { status: 500 }
    );
  }
}
