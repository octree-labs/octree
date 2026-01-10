import { NextResponse } from 'next/server';
import { headers } from 'next/headers';
import Stripe from 'stripe';
import { createClient as createServerClient } from '@supabase/supabase-js';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2025-02-24.acacia',
});

const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET!;

function createServiceClient() {
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    }
  );
}

export async function POST(request: Request) {
  try {
    const body = await request.text();
    const headersList = await headers();
    const signature = headersList.get('stripe-signature');

    if (!signature) {
      return NextResponse.json(
        { error: 'No signature provided' },
        { status: 400 }
      );
    }

    let event: Stripe.Event;

    try {
      event = stripe.webhooks.constructEvent(body, signature, webhookSecret);
    } catch (err) {
      console.error('Webhook signature verification failed:', err);
      return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
    }

    const supabase = createServiceClient();

    switch (event.type) {
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted':
        const subscription = event.data.object as Stripe.Subscription;
        const userId = subscription.metadata?.user_id;
        const customerId = subscription.customer as string;

        if (!userId) {
          console.error('No user_id in subscription metadata');
          return NextResponse.json(
            { error: 'Missing user_id in subscription metadata' },
            { status: 400 }
          );
        }

        try {
          // @ts-ignore
          await supabase.rpc('update_user_subscription_status', {
            p_user_id: userId,
            p_stripe_customer_id: customerId,
            p_stripe_subscription_id: subscription.id,
            p_subscription_status: subscription.status,
            p_current_period_start: new Date(
              subscription.current_period_start * 1000
            ).toISOString(),
            p_current_period_end: new Date(
              subscription.current_period_end * 1000
            ).toISOString(),
            p_cancel_at_period_end: subscription.cancel_at_period_end,
          });

          if (
            subscription.status === 'active' ||
            subscription.status === 'trialing'
          ) {
            // @ts-ignore
            if (
              subscription.status === 'active' ||
              subscription.status === 'trialing'
            ) {
              // @ts-ignore
              const { error: upsertError } = await supabase
                .from('user_usage')
                .upsert(
                  {
                    user_id: userId,
                    onboarding_completed: true,
                  },
                  {
                    onConflict: 'user_id',
                  }
                );

              if (upsertError) {
                console.error(
                  'Failed to update onboarding_completed:',
                  upsertError
                );
              }
            }
          }
        } catch (error) {
          console.error('Error updating subscription in database:', error);
        }
        break;
    }

    return NextResponse.json({ received: true });
  } catch (error) {
    console.error('Webhook processing failed:', error);
    return NextResponse.json(
      { error: 'Webhook processing failed' },
      { status: 500 }
    );
  }
}
