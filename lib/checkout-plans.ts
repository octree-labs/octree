import type Stripe from 'stripe';

import { PRICE_LOOKUP_KEYS, type PriceLookupKey } from '@/lib/stripe-prices';

/**
 * What /api/checkout-session sells, and how a request body maps onto it.
 * Pure, so the mapping (including the legacy `{ annual }` flag) is unit
 * tested without Stripe or Supabase.
 *
 * - `monthly`, `annual`, `semester`: recurring Pro plans (Checkout
 *   `mode: 'subscription'`).
 * - `credits_100`: a one-time pack of 100 AI edit credits (`mode: 'payment'`).
 * - `weekly`: retired for new purchases. Existing weekly subscribers keep
 *   their subscription (the webhook does not look at the price), but the
 *   route refuses to start a new one.
 */

export const SUBSCRIPTION_PLANS = ['monthly', 'annual', 'semester'] as const;
export type SubscriptionPlan = (typeof SUBSCRIPTION_PLANS)[number];

export const CREDIT_PLANS = ['credits_100'] as const;
export type CreditPlan = (typeof CREDIT_PLANS)[number];

export type PurchasePlan = SubscriptionPlan | CreditPlan;

export const PURCHASE_PLANS: readonly PurchasePlan[] = [...SUBSCRIPTION_PLANS, ...CREDIT_PLANS];

export const CREDITS_PER_PACK: Record<CreditPlan, number> = {
  credits_100: 100,
};

export const WEEKLY_PLAN_RETIRED_MESSAGE =
  'The weekly plan is no longer available. Choose the monthly, annual or semester plan instead.';

export function isPurchasePlan(value: unknown): value is PurchasePlan {
  return typeof value === 'string' && (PURCHASE_PLANS as readonly string[]).includes(value);
}

export function isSubscriptionPlan(plan: PurchasePlan): plan is SubscriptionPlan {
  return (SUBSCRIPTION_PLANS as readonly string[]).includes(plan);
}

export function lookupKeyForPlan(plan: PurchasePlan): PriceLookupKey {
  return PRICE_LOOKUP_KEYS[plan];
}

export type ResolvedCheckoutPlan =
  | { ok: true; plan: PurchasePlan; withTrial: boolean }
  | { ok: false; error: string };

/**
 * Maps a request body to a plan.
 *
 * `plan` wins when present. Without it the legacy `{ annual }` flag applies:
 * `annual: true` always meant the $9.99/month price and still does. A body
 * with neither (older callers sent an empty POST) defaults to monthly rather
 * than to the retired weekly plan. Explicit `annual: false` or
 * `plan: 'weekly'` is a request for the weekly plan and is refused.
 */
export function resolveCheckoutPlan(body: unknown): ResolvedCheckoutPlan {
  const input = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  const withTrial = input.withTrial === true;

  if (input.plan !== undefined) {
    if (input.plan === 'weekly') return { ok: false, error: WEEKLY_PLAN_RETIRED_MESSAGE };
    if (!isPurchasePlan(input.plan)) {
      return { ok: false, error: `Unknown plan: ${String(input.plan)}` };
    }
    return { ok: true, plan: input.plan, withTrial };
  }

  if (input.annual === false) return { ok: false, error: WEEKLY_PLAN_RETIRED_MESSAGE };

  return { ok: true, plan: 'monthly', withTrial };
}

export interface CheckoutSessionInput {
  plan: PurchasePlan;
  priceId: string;
  userId: string;
  /** Known Stripe customer; when null, Checkout creates one from `email`. */
  customerId: string | null;
  email: string | null | undefined;
  origin: string;
  withTrial: boolean;
}

/**
 * The Checkout Session parameters for a plan. Subscription plans carry the
 * user id on the subscription (the webhook keys on it); the credit pack
 * carries the credit count on the session instead.
 */
export function buildCheckoutSessionParams(
  input: CheckoutSessionInput
): Stripe.Checkout.SessionCreateParams {
  const { plan, priceId, userId, customerId, email, origin, withTrial } = input;

  const params: Stripe.Checkout.SessionCreateParams = {
    line_items: [{ price: priceId, quantity: 1 }],
    mode: isSubscriptionPlan(plan) ? 'subscription' : 'payment',
    success_url: `${origin}/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: isSubscriptionPlan(plan)
      ? `${origin}/onboarding?canceled=true`
      : `${origin}/settings?canceled=true`,
    automatic_tax: { enabled: true },
    allow_promotion_codes: true,
    locale: 'auto',
    metadata: { user_id: userId, plan },
  };

  if (customerId) {
    params.customer = customerId;
    // Automatic tax needs an address on the customer; let Checkout fill it.
    params.customer_update = { address: 'auto', name: 'auto' };
  } else if (email) {
    params.customer_email = email;
  }

  if (isSubscriptionPlan(plan)) {
    params.subscription_data = { metadata: { user_id: userId, plan } };
    if (withTrial) params.subscription_data.trial_period_days = 3;
  } else {
    params.metadata = { ...params.metadata, credits: String(CREDITS_PER_PACK[plan]) };
    params.payment_intent_data = { metadata: { user_id: userId, plan } };
    // So the next purchase reuses the same customer record.
    if (!customerId) params.customer_creation = 'always';
  }

  return params;
}
