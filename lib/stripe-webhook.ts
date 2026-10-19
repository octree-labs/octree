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

export type SubscriptionUpdatedEvent = {
  type: string;
  data: {
    object: Pick<Stripe.Subscription, 'status'> & Partial<Stripe.Subscription>;
    previous_attributes?: Partial<Stripe.Subscription> | null;
  };
};

/**
 * True for the one `customer.subscription.updated` that moves a subscription
 * INTO past_due / unpaid from a status that was not delinquent: the moment a
 * renewal charge failed and Smart Retries began. Later updates while it stays
 * past_due (retries, metadata, the status going back to active) are not
 * transitions. Stripe's `previous_attributes` carries the old status only
 * when it changed, so a redelivered event answers the same as the first.
 *
 * The endpoint does not receive `invoice.payment_failed`, which is why the
 * dunning email keys on this transition instead.
 */
export function enteredDelinquency(event: SubscriptionUpdatedEvent): boolean {
  if (event.type !== 'customer.subscription.updated') return false;
  const status = event.data.object.status;
  const previous = event.data.previous_attributes?.status;
  if (typeof previous !== 'string' || previous === status) return false;
  return DELINQUENT_STATUSES.has(status) && !DELINQUENT_STATUSES.has(previous);
}

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
 * The generation credits a Checkout Session bought, or 0 when it is not a
 * paid, payment-mode session carrying `metadata.generation_credits`
 * (app/api/checkout-session sets that for the $2.99 one-off).
 */
export function generationCreditsFromSession(
  session: Pick<Stripe.Checkout.Session, 'mode' | 'payment_status' | 'metadata'>
): number {
  if (session.mode !== 'payment' || session.payment_status !== 'paid') return 0;
  const raw = session.metadata?.generation_credits;
  if (raw == null) return 0;
  const credits = Number.parseInt(String(raw), 10);
  return Number.isInteger(credits) && credits > 0 ? credits : 0;
}

export type GrantGenerationCreditsResult =
  | { granted: true; userId: string; credits: number }
  | { granted: false; reason: 'not_a_credit_purchase' | 'missing_user' | 'already_granted' };

/**
 * Grants the credits a paid one-off Checkout Session bought. Runs with the
 * service-role client through the service-role-only
 * `grant_generation_purchase` RPC, which writes the `generation_purchases`
 * ledger row (unique per session id) and moves the balance in ONE
 * transaction and returns NULL when the session was already credited. So a
 * redelivered event grants once, and a failure (thrown here, 500 from the
 * webhook) commits nothing: Stripe's retry grants cleanly instead of finding
 * a ledger row without its balance.
 */
export async function grantGenerationCredits(
  supabase: SupabaseClient<any, any, any>,
  session: Stripe.Checkout.Session
): Promise<GrantGenerationCreditsResult> {
  const credits = generationCreditsFromSession(session);
  if (credits === 0) return { granted: false, reason: 'not_a_credit_purchase' };

  const userId = session.metadata?.user_id;
  if (!userId) return { granted: false, reason: 'missing_user' };

  const { data, error } = await supabase.rpc('grant_generation_purchase', {
    p_user_id: userId,
    p_checkout_session_id: session.id,
    p_credits: credits,
    p_amount_cents: typeof session.amount_total === 'number' ? session.amount_total : null,
    p_currency: session.currency ?? null,
  });
  if (error) throw error;
  if (data === null || data === undefined) return { granted: false, reason: 'already_granted' };

  return { granted: true, userId, credits };
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
 * Credits a paid credit-pack Checkout Session to the buyer through one
 * service-role RPC (`grant_credit_purchase`): the ledger row
 * (`credit_purchases`, unique on the session id) and the balance bump happen
 * in a single transaction, so a retry can never find a ledger row without
 * its credits. A session already in the ledger returns NULL from the RPC and
 * grants nothing, which makes the ledger, not the webhook event log, the
 * idempotency guard. Any database error is thrown so Stripe retries.
 */
export async function grantCreditsFromCheckoutSession(
  supabase: SupabaseClient<any, any, any>,
  session: Pick<Stripe.Checkout.Session, 'id' | 'mode' | 'payment_status' | 'metadata' | 'amount_total' | 'currency'>
): Promise<CreditGrantResult> {
  const pack = creditsFromCheckoutSession(session);
  if (!pack) return { granted: false, reason: 'not_credits' };

  const { data, error } = await supabase.rpc('grant_credit_purchase', {
    p_user_id: pack.userId,
    p_checkout_session_id: session.id,
    p_credits: pack.credits,
    p_amount_cents: typeof session.amount_total === 'number' ? session.amount_total : 0,
    p_currency: session.currency ?? 'usd',
  });
  if (error) throw error;

  if (data === null || data === undefined) return { granted: false, reason: 'duplicate' };

  return {
    granted: true,
    userId: pack.userId,
    credits: pack.credits,
    balance: typeof data === 'number' ? data : null,
  };
}
