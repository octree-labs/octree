import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { stripe } from '@/lib/stripe';
import { resolveStripeCustomer } from '@/lib/stripe-customer';
import { captureServerExceptionAfterResponse } from '@/lib/posthog-server';

export async function POST() {
  try {
    const supabase = await createClient();

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const customer = await resolveStripeCustomer(supabase, user);

    if (!customer) {
      return NextResponse.json(
        { error: 'No customer found for this user' },
        { status: 404 }
      );
    }

    // Get the user's subscription from Stripe using customer ID
    const subscriptions = await stripe.subscriptions.list({
      customer: customer.customerId,
      status: 'active',
      limit: 1,
    });

    if (subscriptions.data.length === 0) {
      return NextResponse.json(
        { error: 'No active subscription found' },
        { status: 404 }
      );
    }

    const subscription = subscriptions.data[0];

    // Cancel the subscription at the end of the current period
    const canceledSubscription = await stripe.subscriptions.update(
      subscription.id,
      {
        cancel_at_period_end: true,
      }
    );

    return NextResponse.json({
      success: true,
      subscription: {
        id: canceledSubscription.id,
        status: canceledSubscription.status,
        cancel_at_period_end: canceledSubscription.cancel_at_period_end,
        current_period_end: canceledSubscription.current_period_end,
      },
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
