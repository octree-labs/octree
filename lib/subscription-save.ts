import { NextResponse } from 'next/server';
import type Stripe from 'stripe';

import { createClient } from '@/lib/supabase/server';
import { stripe } from '@/lib/stripe';
import { resolveStripeCustomer } from '@/lib/stripe-customer';
import {
  SAVE_COUPON_ID,
  SAVE_COUPON_MONTHS,
  SAVE_COUPON_PERCENT_OFF,
} from '@/lib/stripe-subscription';

/**
 * Shared server side of the cancel-flow routes (app/api/subscription/* and
 * app/api/cancel-subscription). Every route needs the same three steps: the
 * signed-in user, their Stripe customer, and that customer's live
 * subscription. The subscription is always looked up *by customer*, never
 * taken from the request, so a caller can only ever act on their own.
 */

export interface OwnedSubscription {
  user: { id: string; email?: string | null };
  customerId: string;
  subscription: Stripe.Subscription;
}

export type OwnedSubscriptionResult =
  | { ok: true; value: OwnedSubscription }
  | { ok: false; response: NextResponse };

function fail(status: number, error: string): OwnedSubscriptionResult {
  return { ok: false, response: NextResponse.json({ error }, { status }) };
}

/** The customer's active subscription, else their trialing one, else null. */
export async function findLiveSubscription(
  customerId: string
): Promise<Stripe.Subscription | null> {
  for (const status of ['active', 'trialing'] as const) {
    const subs = await stripe.subscriptions.list({ customer: customerId, status, limit: 1 });
    if (subs.data[0]) return subs.data[0];
  }
  return null;
}

export async function requireOwnedSubscription(): Promise<OwnedSubscriptionResult> {
  const supabase = await createClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) return fail(401, 'Unauthorized');

  const customer = await resolveStripeCustomer(supabase, user);
  if (!customer) return fail(404, 'No customer found for this user');

  const subscription = await findLiveSubscription(customer.customerId);
  if (!subscription) return fail(404, 'No active subscription found');

  if (subscription.customer !== customer.customerId) {
    // Cannot happen for a list-by-customer result; kept as a hard guard.
    return fail(403, 'Subscription does not belong to this customer');
  }

  return { ok: true, value: { user, customerId: customer.customerId, subscription } };
}

function stripeErrorCode(error: unknown): string | undefined {
  return (error as { code?: string } | null)?.code;
}

/**
 * The save coupon, created on first use. The fixed id makes this idempotent
 * across requests and across environments (test and live each get their own).
 */
export async function ensureSaveCoupon(): Promise<Stripe.Coupon> {
  try {
    return await stripe.coupons.retrieve(SAVE_COUPON_ID);
  } catch (error) {
    if (stripeErrorCode(error) !== 'resource_missing') throw error;
  }

  try {
    return await stripe.coupons.create({
      id: SAVE_COUPON_ID,
      name: `${SAVE_COUPON_PERCENT_OFF}% off for ${SAVE_COUPON_MONTHS} months`,
      percent_off: SAVE_COUPON_PERCENT_OFF,
      duration: 'repeating',
      duration_in_months: SAVE_COUPON_MONTHS,
    });
  } catch (error) {
    // Two requests raced past the retrieve; the other one won.
    if (stripeErrorCode(error) === 'resource_already_exists') {
      return stripe.coupons.retrieve(SAVE_COUPON_ID);
    }
    throw error;
  }
}

export function subscriptionSummary(subscription: Stripe.Subscription) {
  return {
    id: subscription.id,
    status: subscription.status,
    cancel_at_period_end: subscription.cancel_at_period_end,
    current_period_end: subscription.current_period_end,
    paused_until: subscription.pause_collection?.resumes_at ?? null,
  };
}
