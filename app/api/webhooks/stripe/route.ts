import { NextResponse } from 'next/server';
import { headers } from 'next/headers';
import Stripe from 'stripe';

import { createAdminClient } from '@/lib/supabase/admin';

import {
  describeCheckoutSessionPlan,
  grantCreditsFromCheckoutSession,
  recordStripeEvent,
  subscriptionLifecycleEvents,
  trackPurchaseFromCheckoutSession,
} from '@/lib/stripe-webhook';
import { AnalyticsEvents } from '@/lib/analytics/events';
import { effectiveSubscriptionStatus, isProStatus } from '@/lib/stripe-subscription';
import {
  monthlyResetDateFor,
  startsNewBillingPeriod,
  type StoredBillingRow,
} from '@/lib/subscription/billing-period';
import {
  afterResponse,
  captureServerEvent,
  captureServerEventAfterResponse,
  captureServerExceptionAfterResponse,
} from '@/lib/posthog-server';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2025-02-24.acacia',
});

const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET!;

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

    const supabase = createAdminClient();

    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        // Reddit `Purchase` fires here, on confirmed payment, not on the
        // checkout button click (see app/onboarding/page.tsx).
        //
        // The conversion is the one side effect that must not run twice, so
        // the idempotency log is consulted only here. The subscription events
        // below are left as they were: re-processing a retry writes the same
        // state again, and a retry after a timeout must still be able to heal
        // user_usage.
        try {
          const isNew = await recordStripeEvent(supabase, event);
          if (!isNew) {
            return NextResponse.json({ received: true, duplicate: true });
          }
          await trackPurchaseFromCheckoutSession(session);
        } catch (error) {
          console.error('Failed to track purchase conversion:', error);
        }
        // A paid credit pack (`mode: 'payment'`, `metadata.credits`): ledger
        // row + balance. The ledger is unique on the session id, so a retry
        // that got past the event log above still grants once. A database
        // failure here must reach Stripe (500) so the delivery is retried
        // and the buyer is not left without their credits.
        if (session.mode === 'payment') {
          const grant = await grantCreditsFromCheckoutSession(supabase, session);
          if (grant.granted) {
            captureServerEventAfterResponse(grant.userId, AnalyticsEvents.CREDITS_PURCHASED, {
              credits: grant.credits,
              amount: typeof session.amount_total === 'number' ? session.amount_total / 100 : null,
              currency: session.currency ? session.currency.toUpperCase() : null,
            });
          }
          break;
        }
        // PostHog `subscription_started` (the "paid" funnel step). Analytics
        // can never fail the webhook.
        try {
          const userId = session.metadata?.user_id;
          if (userId && session.payment_status === 'paid') {
            afterResponse(async () =>
              captureServerEvent(
                userId,
                AnalyticsEvents.SUBSCRIPTION_STARTED,
                await describeCheckoutSessionPlan(stripe, session)
              )
            );
          }
        } catch (error) {
          console.error('PostHog subscription_started failed:', error);
        }
        break;
      }
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
          const currentPeriodStart = subscription.current_period_start
            ? new Date(subscription.current_period_start * 1000).toISOString()
            : null;
          const currentPeriodEnd = subscription.current_period_end
            ? new Date(subscription.current_period_end * 1000).toISOString()
            : null;

          // A paused subscription (`pause_collection` set) is still `active`
          // to Stripe but `paused` to the app: no Pro while no invoice is
          // collected. Stripe clears the pause at `resumes_at` and sends
          // another `customer.subscription.updated`, which flips it back.
          const effectiveStatus = effectiveSubscriptionStatus(subscription);
          const isActive = isProStatus(effectiveStatus);

          // Stripe sends customer.subscription.updated for renewals, but
          // also for cancel_at_period_end toggles, pauses, discounts and
          // metadata writes. Only a new billing period resets the Pro
          // monthly counter (lib/subscription/billing-period.ts); the
          // other writes keep it.
          const { data: storedRow, error: storedError } = await supabase
            .from('user_usage')
            .select('is_pro, stripe_subscription_id, current_period_start, monthly_reset_date')
            .eq('user_id', userId)
            .maybeSingle();
          if (storedError) {
            // Unknown state: keep the counter. A missed renewal still resets
            // lazily on monthly_reset_date inside increment_edit_count.
            console.error('Failed to read user_usage before subscription update:', storedError);
          }
          const resetMonthly = !storedError && startsNewBillingPeriod(storedRow as StoredBillingRow | null, {
            customerId,
            subscriptionId: subscription.id,
            status: effectiveStatus,
            isPro: isActive,
            currentPeriodStart,
            currentPeriodEnd,
            cancelAtPeriodEnd: subscription.cancel_at_period_end,
          });

          const updateData: any = {
            stripe_customer_id: customerId,
            stripe_subscription_id: subscription.id,
            subscription_status: effectiveStatus,
            current_period_start: currentPeriodStart,
            current_period_end: currentPeriodEnd,
            cancel_at_period_end: subscription.cancel_at_period_end,
            is_pro: isActive,
            updated_at: new Date().toISOString(),
          };

          if (resetMonthly) {
            updateData.monthly_edit_count = 0;
            updateData.monthly_reset_date = monthlyResetDateFor(currentPeriodEnd);
          }

          const { error: updateError } = await supabase
            .from('user_usage')
            .update(updateData)
            .eq('user_id', userId);

          if (updateError) {
            console.error('Failed to update subscription status:', updateError);
            throw updateError;
          }

          if (isActive) {
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
        } catch (error) {
          console.error('Error updating subscription in database:', error);
        }

        // PostHog churn / recovery events, after the DB writes. Never fails
        // the webhook.
        try {
          for (const lifecycle of subscriptionLifecycleEvents(event as any)) {
            captureServerEventAfterResponse(userId, lifecycle.event, lifecycle.properties);
          }
        } catch (error) {
          console.error('PostHog subscription lifecycle event failed:', error);
        }
        break;
    }

    return NextResponse.json({ received: true });
  } catch (error) {
    console.error('Webhook processing failed:', error);
    captureServerExceptionAfterResponse(error, { route: 'api/webhooks/stripe' });
    return NextResponse.json(
      { error: 'Webhook processing failed' },
      { status: 500 }
    );
  }
}
