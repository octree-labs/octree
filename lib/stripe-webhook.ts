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
import { PRICE_LOOKUP_KEYS, PRICE_METADATA_KEY, isPriceLookupKey } from '@/lib/stripe-prices';

/** One server-side analytics event with its typed properties. */
export type ServerAnalyticsEvent = {
  [E in AnalyticsEvent]: { event: E; properties: AnalyticsEventProperties[E] };
}[AnalyticsEvent];

type SubscriptionInterval = AnalyticsEventProperties['subscription_started']['interval'];

const PLAN_BY_LOOKUP_KEY: Record<string, CheckoutPlan> = {
  [PRICE_LOOKUP_KEYS.monthly]: 'monthly',
  [PRICE_LOOKUP_KEYS.annual]: 'annual',
  [PRICE_LOOKUP_KEYS.semester]: 'semester',
};

/**
 * Which plan a Stripe price is. New prices are recognised by their
 * `lookup_key` or `metadata.octree_plan` (lib/stripe-prices.ts), never by a
 * hard-coded id; the two pre-existing prices (monthly, and the retired
 * weekly plan that existing subscribers are still on) fall back to the ids
 * in lib/stripe-config.ts.
 */
export function planFromPrice(
  price: Pick<Stripe.Price, 'id'> & Partial<Pick<Stripe.Price, 'lookup_key' | 'metadata'>> | null | undefined
): CheckoutPlan | 'unknown' {
  if (!price) return 'unknown';
  const key = price.lookup_key ?? price.metadata?.[PRICE_METADATA_KEY];
  if (isPriceLookupKey(key) && key in PLAN_BY_LOOKUP_KEY) return PLAN_BY_LOOKUP_KEY[key];
  if (price.id === STRIPE_PRICE_IDS.proAnnual) return 'monthly';
  if (price.id === STRIPE_PRICE_IDS.pro) return 'weekly';
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
    plan: planFromPrice(price),
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

/** The credit pack a paid Checkout Session carries, or null for anything else. */
export function creditsFromCheckoutSession(
  session: Pick<Stripe.Checkout.Session, 'mode' | 'payment_status' | 'metadata'>
): { userId: string; credits: number } | null {
  if (session.mode !== 'payment' || session.payment_status !== 'paid') return null;
  const userId = session.metadata?.user_id;
  const credits = Number(session.metadata?.credits);
  if (!userId || !Number.isInteger(credits) || credits <= 0) return null;
  return { userId, credits };
}

export type CreditGrantResult =
  | { granted: true; userId: string; credits: number; balance: number | null }
  | { granted: false; reason: 'not_credits' | 'duplicate' };

/**
 * Credits a paid credit-pack Checkout Session to the buyer: one ledger row
 * (`credit_purchases`, unique on the session id) and then the balance bump.
 * A redelivered event hits the unique constraint and grants nothing, so the
 * ledger insert, not the event log, is the idempotency guard. Any other
 * database error is thrown so Stripe retries the delivery.
 */
export async function grantCreditsFromCheckoutSession(
  supabase: SupabaseClient<any, any, any>,
  session: Pick<Stripe.Checkout.Session, 'id' | 'mode' | 'payment_status' | 'metadata' | 'amount_total' | 'currency'>
): Promise<CreditGrantResult> {
  const pack = creditsFromCheckoutSession(session);
  if (!pack) return { granted: false, reason: 'not_credits' };

  const { error: ledgerError } = await supabase.from('credit_purchases').insert({
    user_id: pack.userId,
    checkout_session_id: session.id,
    credits: pack.credits,
    amount_cents: typeof session.amount_total === 'number' ? session.amount_total : 0,
    currency: session.currency ?? 'usd',
  });

  if (ledgerError) {
    // 23505 = unique_violation: this session was already credited.
    if (ledgerError.code === '23505') return { granted: false, reason: 'duplicate' };
    throw ledgerError;
  }

  const { data, error } = await supabase.rpc('add_edit_credits', {
    p_user_id: pack.userId,
    p_credits: pack.credits,
  });
  if (error) throw error;

  return {
    granted: true,
    userId: pack.userId,
    credits: pack.credits,
    balance: typeof data === 'number' ? data : null,
  };
}
