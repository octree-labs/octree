import { NextResponse } from 'next/server';

import { requireOwnedSubscription } from '@/lib/subscription-save';
import { describeSubscriptionOffers } from '@/lib/stripe-subscription';
import { AnalyticsEvents } from '@/lib/analytics/events';
import {
  captureServerEventAfterResponse,
  captureServerExceptionAfterResponse,
} from '@/lib/posthog-server';

/**
 * What the cancel dialog needs before it renders: which save offers still
 * apply to this subscription. Called when the dialog opens, so it is also
 * where `cancel_flow_opened` is captured.
 */
export async function GET() {
  try {
    const owned = await requireOwnedSubscription();
    if (!owned.ok) return owned.response;

    const { user, subscription } = owned.value;
    const offers = describeSubscriptionOffers(subscription);

    captureServerEventAfterResponse(user.id, AnalyticsEvents.CANCEL_FLOW_OPENED, {
      is_paused: offers.effective_status === 'paused',
      has_discount: offers.has_discount,
      cancel_at_period_end: offers.cancel_at_period_end,
    });

    return NextResponse.json({ subscription: offers });
  } catch (error) {
    console.error('Error loading cancel offers:', error);
    captureServerExceptionAfterResponse(error, { route: 'api/subscription/offers' });
    return NextResponse.json({ error: 'Failed to load subscription' }, { status: 500 });
  }
}
