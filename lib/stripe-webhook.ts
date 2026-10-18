import type Stripe from 'stripe';
import type { SupabaseClient } from '@supabase/supabase-js';

import { trackRedditConversion } from '@/lib/reddit-capi';
import {
  AnalyticsEvents,
  type AnalyticsEvent,
  type AnalyticsEventProperties,
  type CheckoutPlan,
} from '@/lib/analytics/events';
import { STRIPE_PRICE_IDS } from '@/lib/stripe-config';

/** One server-side analytics event with its typed properties. */
export type ServerAnalyticsEvent = {
  [E in AnalyticsEvent]: { event: E; properties: AnalyticsEventProperties[E] };
}[AnalyticsEvent];

type SubscriptionInterval = AnalyticsEventProperties['subscription_started']['interval'];

function planFromPriceId(priceId: string | null | undefined): CheckoutPlan | 'unknown' {
  if (priceId === STRIPE_PRICE_IDS.proAnnual) return 'monthly';
  if (priceId === STRIPE_PRICE_IDS.pro) return 'weekly';
  return 'unknown';
}

function intervalFromPrice(price: Stripe.Price | null | undefined): SubscriptionInterval {
  const interval = price?.recurring?.interval;
  return interval === 'month' || interval === 'week' || interval === 'year' || interval === 'day'
    ? interval
    : 'unknown';
}

/**
 * The `subscription_started` properties for a paid Checkout Session. The
 * line item is fetched from Stripe because the webhook payload does not
 * include it; any failure degrades to `unknown` rather than throwing.
 */
export async function describeCheckoutSessionPlan(
  stripe: Pick<Stripe, 'checkout'>,
  session: Stripe.Checkout.Session
): Promise<AnalyticsEventProperties['subscription_started']> {
  let price: Stripe.Price | null | undefined;
  try {
    const items = await stripe.checkout.sessions.listLineItems(session.id, {
      limit: 1,
      expand: ['data.price'],
    });
    price = items.data[0]?.price;
  } catch (error) {
    console.error('Could not read checkout line items for analytics:', error);
  }

  return {
    plan: planFromPriceId(price?.id),
    interval: intervalFromPrice(price),
    amount: typeof session.amount_total === 'number' ? session.amount_total / 100 : null,
    currency: session.currency ? session.currency.toUpperCase() : null,
  };
}

const DELINQUENT_STATUSES = new Set(['past_due', 'unpaid']);
const RECOVERABLE_STATUSES = new Set(['past_due', 'unpaid', 'incomplete']);

/**
 * Maps a `customer.subscription.*` event to the lifecycle events the funnel
 * needs (churn and recovery). Pure, so it is unit-testable; the route is
 * responsible for sending them.
 *
 * - created (active/trialing)      -> onboarding_completed { plan: 'pro' }
 * - updated, renewal switched off  -> subscription_canceled { at_period_end }
 * - deleted                        -> subscription_canceled { deleted }
 * - updated, status -> past_due    -> subscription_past_due
 * - updated, renewal switched back on, or status past_due -> active
 *                                  -> subscription_reactivated
 *
 * `onboarding_completed` fires for every first subscription of a customer
 * record, so a user who re-subscribes months later counts again; the paid
 * onboarding path has no other server-side signal.
 */
export function subscriptionLifecycleEvents(event: {
  type: string;
  data: {
    object: Stripe.Subscription;
    previous_attributes?: Partial<Stripe.Subscription> | null;
  };
}): ServerAnalyticsEvent[] {
  const subscription = event.data.object;
  const previous = event.data.previous_attributes ?? {};
  const status = subscription.status;
  const events: ServerAnalyticsEvent[] = [];

  if (event.type === 'customer.subscription.created') {
    if (status === 'active' || status === 'trialing') {
      events.push({
        event: AnalyticsEvents.ONBOARDING_COMPLETED,
        properties: { plan: 'pro' },
      });
    }
    return events;
  }

  if (event.type === 'customer.subscription.deleted') {
    events.push({
      event: AnalyticsEvents.SUBSCRIPTION_CANCELED,
      properties: { kind: 'deleted', status },
    });
    return events;
  }

  if (event.type !== 'customer.subscription.updated') return events;

  const renewalChanged = typeof previous.cancel_at_period_end === 'boolean';
  if (renewalChanged && subscription.cancel_at_period_end) {
    events.push({
      event: AnalyticsEvents.SUBSCRIPTION_CANCELED,
      properties: { kind: 'at_period_end', status },
    });
  } else if (renewalChanged && !subscription.cancel_at_period_end && status === 'active') {
    events.push({
      event: AnalyticsEvents.SUBSCRIPTION_REACTIVATED,
      properties: { previous_status: previous.status ?? status, status },
    });
  }

  const statusChanged = typeof previous.status === 'string' && previous.status !== status;
  if (statusChanged && DELINQUENT_STATUSES.has(status)) {
    events.push({
      event: AnalyticsEvents.SUBSCRIPTION_PAST_DUE,
      properties: { status },
    });
  } else if (
    statusChanged &&
    status === 'active' &&
    previous.status &&
    RECOVERABLE_STATUSES.has(previous.status)
  ) {
    events.push({
      event: AnalyticsEvents.SUBSCRIPTION_REACTIVATED,
      properties: { previous_status: previous.status, status },
    });
  }

  return events;
}

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
