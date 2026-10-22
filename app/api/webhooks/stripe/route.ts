import { NextResponse } from 'next/server';
import { headers } from 'next/headers';
import Stripe from 'stripe';

import { createAdminClient } from '@/lib/supabase/admin';

import {
  checkoutAttributionFromMetadata,
  describeCheckoutSessionPlan,
  enteredDelinquency,
  exportProjectFromSession,
  generationCreditsFromSession,
  grantCreditsFromCheckoutSession,
  grantExportUnlock,
  grantGenerationCredits,
  isOctreeCheckoutSession,
  isOctreeSubscription,
  recordStripeEvent,
  subscriptionLifecycleEvents,
  trackPurchaseFromCheckoutSession,
} from '@/lib/stripe-webhook';
import { AnalyticsEvents, type PurchasePlan } from '@/lib/analytics/events';
import { isPurchasePlan } from '@/lib/checkout-plans';
import { getUnsubscribeSecret } from '@/lib/email/unsubscribe';
import { createLifecycleDeps } from '@/lib/lifecycle/deps';
import { sendCheckoutRecoveryEmail, sendPaymentFailedEmail } from '@/lib/lifecycle/billing-send';
import type { LifecycleSendDeps } from '@/lib/lifecycle/send';
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

/**
 * The mailer/ledger for the billing-recovery emails this route sends at
 * once (lib/lifecycle/billing-send.ts). Null, with a log line, when the
 * unsubscribe secret is not configured: the email is skipped, never the
 * webhook.
 */
function lifecycleDeps(supabase: ReturnType<typeof createAdminClient>): LifecycleSendDeps | null {
  const secret = getUnsubscribeSecret();
  if (!secret) {
    console.error('[billing-recovery] EMAIL_UNSUBSCRIBE_SECRET (or CRON_SECRET) is not set; email skipped');
    return null;
  }
  return createLifecycleDeps(supabase, {
    secret,
    capture: (userId, template) =>
      captureServerEventAfterResponse(userId, AnalyticsEvents.LIFECYCLE_EMAIL_SENT, { template }),
  });
}

/**
 * The Stripe account is shared with another product whose events reach this
 * endpoint too (lib/stripe-webhook.ts, `isOctreeCheckoutSession`). Its
 * objects are acknowledged with a 200 and nothing else: no grant, no
 * analytics, no event log, no email. A 4xx/5xx would only make Stripe retry
 * an event there is nothing to do with.
 */
function ignoreForeignSession(session: Stripe.Checkout.Session) {
  console.log(`[stripe-webhook] ignoring checkout session ${session.id} from another app on this Stripe account`);
  return NextResponse.json({ received: true, ignored: 'foreign_session' });
}

function purchasePlanOf(value: string | null | undefined): PurchasePlan | 'unknown' {
  return value && isPurchasePlan(value) ? value : 'unknown';
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

    const supabase = createAdminClient();

    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        if (!isOctreeCheckoutSession(session)) return ignoreForeignSession(session);

        // A paid one-off (`mode: 'payment'`): an AI edit credit pack
        // (`metadata.credits`), a single generation credit
        // (`metadata.generation_credits`) or an export unlock for one project
        // (`metadata.export_project_id`), granted independently. Each grant
        // runs BEFORE the event log below: its own ledger (unique on the
        // session id, written in the same transaction as the balance) is the
        // idempotency guard, and a database failure must reach Stripe (500)
        // so the delivery is retried. If the event id were logged first, that
        // retry would be dropped as a duplicate and the buyer left without
        // their credits.
        if (session.mode === 'payment') {
          const grant = await grantCreditsFromCheckoutSession(supabase, session);
          if (grant.granted) {
            captureServerEventAfterResponse(grant.userId, AnalyticsEvents.CREDITS_PURCHASED, {
              credits: grant.credits,
              amount: typeof session.amount_total === 'number' ? session.amount_total / 100 : null,
              currency: session.currency ? session.currency.toUpperCase() : null,
            });
          }
          if (generationCreditsFromSession(session) > 0) {
            const generation = await grantGenerationCredits(supabase, session);
            if (generation.granted) {
              captureServerEventAfterResponse(generation.userId, AnalyticsEvents.GENERATION_PURCHASED, {
                credits: generation.credits,
                amount: typeof session.amount_total === 'number' ? session.amount_total / 100 : null,
                currency: session.currency ? session.currency.toUpperCase() : null,
              });
            } else if (generation.reason === 'missing_user') {
              console.error('Generation credit purchase without user_id in metadata:', session.id);
            }
          }
          // The $4.99 export unlock for one project (`metadata.export_project_id`).
          // A missing migration is logged inside and never throws.
          if (exportProjectFromSession(session)) {
            const unlock = await grantExportUnlock(supabase, session);
            if (unlock.granted) {
              captureServerEventAfterResponse(unlock.userId, AnalyticsEvents.EXPORT_UNLOCKED, {
                project_id: unlock.projectId,
                session_id: session.id,
                amount: typeof session.amount_total === 'number' ? session.amount_total / 100 : null,
                ...checkoutAttributionFromMetadata(session.metadata),
              });
            } else if (unlock.reason === 'missing_user') {
              console.error('Export unlock purchase without user_id in metadata:', session.id);
            }
          }
          try {
            if (await recordStripeEvent(supabase, event)) {
              await trackPurchaseFromCheckoutSession(session);
            }
          } catch (error) {
            console.error('Failed to track purchase conversion:', error);
          }
          break;
        }

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

        // Another app's subscription, or one with no user to update (a
        // comped subscription created by hand has empty metadata). Answer
        // 200: a 4xx makes Stripe retry an event there is nothing to do with.
        if (!isOctreeSubscription(subscription) || !userId) {
          if (subscription.metadata?.app && !isOctreeSubscription(subscription)) {
            console.log(`[stripe-webhook] ignoring subscription ${subscription.id} from another app on this Stripe account`);
            return NextResponse.json({ received: true, ignored: 'foreign_subscription' });
          }
          console.warn(`[stripe-webhook] no user_id in metadata of subscription ${subscription.id}; ignored`);
          return NextResponse.json({ received: true, ignored: 'missing_user_id' });
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

        // Dunning: the first update that moves the subscription into
        // past_due / unpaid sends the payment_failed notice for its latest
        // invoice. The ledger (user, template, invoice id) makes a
        // redelivery or a later update of the same delinquency a no-op, and
        // nothing in here can fail the webhook (Stripe would only retry and
        // hit the same ledger row).
        if (enteredDelinquency(event as any)) {
          try {
            const deps = lifecycleDeps(supabase);
            if (deps) {
              const outcome = await sendPaymentFailedEmail({ stripe, supabase, deps, userId, subscription });
              if (outcome.sent) {
                captureServerEventAfterResponse(userId, AnalyticsEvents.PAYMENT_FAILED_EMAIL_SENT, {
                  template: 'payment_failed',
                  amount: outcome.invoice?.amountCents != null ? outcome.invoice.amountCents / 100 : null,
                  currency: outcome.invoice?.currency ? outcome.invoice.currency.toUpperCase() : null,
                  has_retry: outcome.invoice?.nextPaymentAttempt != null,
                });
              } else {
                console.log(`[billing-recovery] payment_failed not sent for ${subscription.id}: ${outcome.reason}`);
              }
            }
          } catch (error) {
            console.error('[billing-recovery] payment_failed email failed:', error);
            captureServerExceptionAfterResponse(error, { route: 'api/webhooks/stripe', extra: { step: 'payment_failed' } });
          }
        }
        break;
      case 'checkout.session.expired': {
        // Abandoned checkout. Stripe attaches `after_expiration.recovery.url`
        // because the session was created with recovery enabled
        // (lib/checkout-plans.ts); the recovery email carries it. Keyed on
        // the session id in the ledger, so a redelivery sends nothing.
        const expired = event.data.object as Stripe.Checkout.Session;
        if (!isOctreeCheckoutSession(expired)) return ignoreForeignSession(expired);
        const expiredUserId = expired.metadata?.user_id;
        if (!expiredUserId) break;

        const plan = purchasePlanOf(expired.metadata?.plan);
        captureServerEventAfterResponse(expiredUserId, AnalyticsEvents.CHECKOUT_ABANDONED, {
          plan,
          amount: typeof expired.amount_total === 'number' ? expired.amount_total / 100 : null,
          currency: expired.currency ? expired.currency.toUpperCase() : null,
          mode: expired.mode,
          recoverable: Boolean(expired.after_expiration?.recovery?.url),
        });

        try {
          const deps = lifecycleDeps(supabase);
          if (deps) {
            const outcome = await sendCheckoutRecoveryEmail({ stripe, supabase, deps, session: expired });
            if (outcome.sent) {
              captureServerEventAfterResponse(expiredUserId, AnalyticsEvents.CHECKOUT_RECOVERY_EMAIL_SENT, {
                template: 'checkout_recovery',
                plan,
                has_offer: false,
              });
            } else {
              console.log(`[billing-recovery] checkout_recovery not sent for ${expired.id}: ${outcome.reason}`);
            }
          }
        } catch (error) {
          console.error('[billing-recovery] checkout_recovery email failed:', error);
          captureServerExceptionAfterResponse(error, { route: 'api/webhooks/stripe', extra: { step: 'checkout_recovery' } });
        }
        break;
      }
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
