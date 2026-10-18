import { NextResponse } from 'next/server';

import { stripe } from '@/lib/stripe';
import { requireOwnedSubscription, subscriptionSummary } from '@/lib/subscription-save';
import {
  isPauseMonths,
  isSubscriptionPaused,
  pauseResumeTimestamp,
} from '@/lib/stripe-subscription';
import { AnalyticsEvents } from '@/lib/analytics/events';
import {
  captureServerEventAfterResponse,
  captureServerExceptionAfterResponse,
} from '@/lib/posthog-server';

/**
 * Pauses collection for 1, 2 or 3 months. Stripe keeps the subscription
 * `active` and voids each invoice until `resumes_at`; the webhook maps that
 * window to the free tier (see lib/stripe-subscription.ts). Taking the offer
 * also turns renewal back on if it had been switched off.
 *
 * Idempotent: a subscription that is already paused is returned as is.
 */
export async function POST(request: Request) {
  try {
    let months: unknown;
    try {
      ({ months } = await request.json());
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }
    if (!isPauseMonths(months)) {
      return NextResponse.json({ error: 'months must be 1, 2 or 3' }, { status: 400 });
    }

    const owned = await requireOwnedSubscription();
    if (!owned.ok) return owned.response;
    const { user, subscription } = owned.value;

    if (isSubscriptionPaused(subscription)) {
      return NextResponse.json({
        success: true,
        alreadyPaused: true,
        subscription: subscriptionSummary(subscription),
      });
    }

    const resumesAt = pauseResumeTimestamp(months);
    const paused = await stripe.subscriptions.update(subscription.id, {
      pause_collection: { behavior: 'void', resumes_at: resumesAt },
      cancel_at_period_end: false,
    });

    captureServerEventAfterResponse(user.id, AnalyticsEvents.CANCEL_OFFER_ACCEPTED, {
      offer: 'pause',
    });
    captureServerEventAfterResponse(user.id, AnalyticsEvents.SUBSCRIPTION_PAUSED, {
      months,
      resumes_at: resumesAt,
    });

    return NextResponse.json({
      success: true,
      alreadyPaused: false,
      subscription: subscriptionSummary(paused),
    });
  } catch (error) {
    console.error('Error pausing subscription:', error);
    captureServerExceptionAfterResponse(error, { route: 'api/subscription/pause' });
    return NextResponse.json({ error: 'Failed to pause subscription' }, { status: 500 });
  }
}
