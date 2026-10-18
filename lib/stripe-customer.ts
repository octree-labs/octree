import type Stripe from 'stripe';
import type { SupabaseClient } from '@supabase/supabase-js';

import { stripe } from '@/lib/stripe';

const LIVE_STATUSES: ReadonlySet<Stripe.Subscription.Status> = new Set([
  'active',
  'trialing',
  'past_due',
]);

export interface ResolvedStripeCustomer {
  customerId: string;
  /** How the id was found; `stored` means user_usage.stripe_customer_id. */
  source: 'stored' | 'email';
}

async function hasLiveSubscription(customerId: string): Promise<boolean> {
  const subs = await stripe.subscriptions.list({
    customer: customerId,
    status: 'all',
    limit: 10,
  });
  return subs.data.some((s) => LIVE_STATUSES.has(s.status));
}

/**
 * True when the stored customer id still points at a live Stripe customer.
 * A customer deleted in the dashboard (or by actions/delete-account.ts) comes
 * back as `{ deleted: true }`; an id Stripe has never seen is `resource_missing`.
 * Any other Stripe error is rethrown so callers see it as they did before.
 */
async function storedCustomerExists(customerId: string): Promise<boolean> {
  try {
    const customer = await stripe.customers.retrieve(customerId);
    return !customer.deleted;
  } catch (error: any) {
    if (error?.code === 'resource_missing') return false;
    throw error;
  }
}

/**
 * Finds the Stripe customer for a signed-in user.
 *
 * 1. Prefer `user_usage.stripe_customer_id` (written by the subscription
 *    webhook, so it always points at the customer that owns the newest
 *    subscription), as long as that customer still exists in Stripe.
 * 2. Otherwise search by email. Checkout creates a new customer object per
 *    session, so one email can map to several customers; pick the newest one
 *    that has an active/trialing/past_due subscription, then the newest one
 *    overall. When the pick has a live subscription, persist it to
 *    `user_usage` so the next call is direct.
 *
 * Returns null when the user has no Stripe customer at all.
 */
export async function resolveStripeCustomer(
  supabase: SupabaseClient<any, any, any>,
  user: { id: string; email?: string | null }
): Promise<ResolvedStripeCustomer | null> {
  const { data: usage } = await supabase
    .from('user_usage')
    .select('stripe_customer_id')
    .eq('user_id', user.id)
    .maybeSingle();

  const storedId: string | null = usage?.stripe_customer_id ?? null;
  if (storedId && (await storedCustomerExists(storedId))) {
    return { customerId: storedId, source: 'stored' };
  }

  if (!user.email) return null;

  // Stripe returns customers newest first and never lists deleted ones.
  const customers = await stripe.customers.list({
    email: user.email,
    limit: 100,
  });
  const candidates = customers.data.filter((c) => !c.deleted);
  if (candidates.length === 0) return null;

  let picked: Stripe.Customer | null = null;
  let pickedIsLive = false;

  if (candidates.length === 1) {
    picked = candidates[0];
    pickedIsLive = await hasLiveSubscription(picked.id);
  } else {
    for (const candidate of candidates) {
      if (await hasLiveSubscription(candidate.id)) {
        picked = candidate;
        pickedIsLive = true;
        break;
      }
    }
    if (!picked) picked = candidates[0];
  }

  // Only a customer that owns a live subscription is worth remembering: a
  // stale or wrong id must never replace one the webhook will write.
  if (pickedIsLive && picked.id !== storedId) {
    const { error } = await supabase
      .from('user_usage')
      .update({ stripe_customer_id: picked.id })
      .eq('user_id', user.id);
    if (error) {
      console.error('Failed to persist stripe_customer_id:', error);
    }
  }

  return { customerId: picked.id, source: 'email' };
}
