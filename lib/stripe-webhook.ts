import type Stripe from 'stripe';
import type { SupabaseClient } from '@supabase/supabase-js';

import { trackRedditConversion } from '@/lib/reddit-capi';

/**
 * Records a Stripe event id so retried deliveries are processed once.
 * Returns true when this is the first time the event is seen.
 *
 * Fails open: if the insert errors for any reason other than a duplicate key
 * (e.g. the table is missing, PostgREST cannot reach the database), the event
 * is treated as new so a storage problem never silently drops webhooks.
 */
export async function recordStripeEvent(
  supabase: SupabaseClient<any, any, any>,
  event: Pick<Stripe.Event, 'id' | 'type'>
): Promise<boolean> {
  try {
    const { error } = await supabase
      .from('stripe_webhook_events')
      .insert({ id: event.id, type: event.type });

    if (!error) return true;

    // 23505 = unique_violation: Stripe re-delivered an event we already handled.
    if (error.code === '23505') return false;

    console.error('Failed to record Stripe webhook event:', error);
    return true;
  } catch (error) {
    console.error('Failed to record Stripe webhook event:', error);
    return true;
  }
}

/**
 * Sends the Reddit `Purchase` conversion for a paid Checkout Session.
 * The session id is the conversion id, so Reddit also dedupes on its side.
 * Returns false when the session is not a paid one (`unpaid`, or
 * `no_payment_required` for a trial that has not charged yet).
 */
export async function trackPurchaseFromCheckoutSession(
  session: Stripe.Checkout.Session
): Promise<boolean> {
  if (session.payment_status !== 'paid') return false;

  const email =
    session.customer_details?.email ?? session.customer_email ?? undefined;
  const externalId = session.metadata?.user_id || undefined;

  await trackRedditConversion({
    eventName: 'Purchase',
    conversionId: session.id,
    email,
    externalId,
    value:
      typeof session.amount_total === 'number'
        ? session.amount_total / 100
        : undefined,
    currency: session.currency ? session.currency.toUpperCase() : undefined,
  });

  return true;
}
