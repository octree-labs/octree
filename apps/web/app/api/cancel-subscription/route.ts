import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { stripe } from '@/lib/stripe';

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

    // Try multiple methods to find the customer
    let customer = null;

    // Method 1: Try to find by email
    try {
      const customersByEmail = await stripe.customers.list({
        email: user.email,
        limit: 1,
      });

      if (customersByEmail.data.length > 0) {
        customer = customersByEmail.data[0];
        console.log('Found customer by email:', customer.id);
      }
    } catch (error) {
      console.log('No customer found by email:', user.email);
    }

    // Method 2: If no customer by email, try to find by user ID in metadata
    if (!customer) {
      try {
        const customersByMetadata = await stripe.customers.list({
          limit: 100, // We'll need to search through customers
        });

        customer = customersByMetadata.data.find(
          (c) =>
            c.metadata?.user_id === user.id ||
            c.metadata?.supabase_user_id === user.id
        );

        if (customer) {
          console.log('Found customer by metadata:', customer.id);
        }
      } catch (error) {
        console.log('Error searching customers by metadata:', error);
      }
    }

    // Method 3: If still no customer, return error
    if (!customer) {
      return NextResponse.json(
        { error: 'No customer found for this user' },
        { status: 404 }
      );
    }

    // Get the user's subscription from Stripe using customer ID
    const subscriptions = await stripe.subscriptions.list({
      customer: customer.id,
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
    return NextResponse.json(
      { error: 'Failed to cancel subscription' },
      { status: 500 }
    );
  }
}
