import type Stripe from 'stripe';

import {
  isCheckoutSource,
  isGenerateEntry,
  type CheckoutSource,
  type GenerateEntry,
} from '@/lib/analytics/events';
import { PRICE_LOOKUP_KEYS, type PriceLookupKey } from '@/lib/stripe-prices';
import { isCheckoutOfferId, offerAppliesToPlan, type CheckoutOfferId } from '@/lib/checkout-offers';

/**
 * What /api/checkout-session sells, and how a request body maps onto it.
 * Pure, so the mapping (including the legacy `{ annual }` flag) is unit
 * tested without Stripe or Supabase.
 *
 * - `monthly`, `annual`, `semester`: recurring Pro plans (Checkout
 *   `mode: 'subscription'`).
 * - `credits_100`: a one-time pack of 100 AI edit credits (`mode: 'payment'`).
 * - `generate_single`: one $2.99 document generation credit (`mode:
 *   'payment'`, `metadata.generation_credits`; the webhook grants it through
 *   grant_generation_purchase and the buyer lands back on /generate).
 * - `weekly`: retired for new purchases. Existing weekly subscribers keep
 *   their subscription (the webhook does not look at the price), but the
 *   route refuses to start a new one.
 */

export const SUBSCRIPTION_PLANS = ['monthly', 'annual', 'semester'] as const;
export type SubscriptionPlan = (typeof SUBSCRIPTION_PLANS)[number];

export const CREDIT_PLANS = ['credits_100'] as const;
export type CreditPlan = (typeof CREDIT_PLANS)[number];

export const GENERATION_PLANS = ['generate_single'] as const;
export type GenerationPlan = (typeof GENERATION_PLANS)[number];

export type PurchasePlan = SubscriptionPlan | CreditPlan | GenerationPlan;

export const PURCHASE_PLANS: readonly PurchasePlan[] = [
  ...SUBSCRIPTION_PLANS,
  ...CREDIT_PLANS,
  ...GENERATION_PLANS,
];

export const GENERATIONS_PER_PURCHASE: Record<GenerationPlan, number> = {
  generate_single: 1,
};

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

export function isGenerationPlan(plan: PurchasePlan): plan is GenerationPlan {
  return (GENERATION_PLANS as readonly string[]).includes(plan);
}

export function lookupKeyForPlan(plan: PurchasePlan): PriceLookupKey {
  return PRICE_LOOKUP_KEYS[plan];
}

/**
 * Where the checkout was started from, for attribution on the Stripe
 * objects. Both are optional and only ever the validated values from
 * lib/analytics/events.ts; anything else the browser sends is dropped,
 * never refused (attribution must not fail a purchase).
 */
export interface CheckoutAttribution {
  source?: CheckoutSource;
  entry?: GenerateEntry;
}

export type ResolvedCheckoutPlan =
  | ({
      ok: true;
      plan: PurchasePlan;
      withTrial: boolean;
      /**
       * A known offer (lib/checkout-offers.ts) that applies to `plan`. An
       * offer for another plan (annual, semester, the one-off purchases) is dropped, not refused.
       */
      offer?: CheckoutOfferId;
    } & CheckoutAttribution)
  | { ok: false; error: string };

/**
 * `offer` from the body: absent (or null / '') is no offer, a known id is
 * kept, anything else is an error (a mistyped link should not silently
 * charge full price without anyone noticing).
 */
function resolveOffer(value: unknown): { ok: true; offer?: CheckoutOfferId } | { ok: false; error: string } {
  if (value === undefined || value === null || value === '') return { ok: true };
  if (isCheckoutOfferId(value)) return { ok: true, offer: value };
  return { ok: false, error: `Unknown offer: ${String(value)}` };
}

function withOffer(plan: PurchasePlan, offer: CheckoutOfferId | undefined): { offer?: CheckoutOfferId } {
  return offer && offerAppliesToPlan(offer, plan) ? { offer } : {};
}

export function resolveCheckoutAttribution(body: unknown): CheckoutAttribution {
  const input = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  const attribution: CheckoutAttribution = {};
  if (isCheckoutSource(input.source)) attribution.source = input.source;
  if (isGenerateEntry(input.entry)) attribution.entry = input.entry;
  return attribution;
}

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
  const attribution = resolveCheckoutAttribution(input);
  const offer = resolveOffer(input.offer);
  if (!offer.ok) return offer;

  if (input.plan !== undefined) {
    if (input.plan === 'weekly') return { ok: false, error: WEEKLY_PLAN_RETIRED_MESSAGE };
    if (!isPurchasePlan(input.plan)) {
      return { ok: false, error: `Unknown plan: ${String(input.plan)}` };
    }
    return { ok: true, plan: input.plan, withTrial, ...attribution, ...withOffer(input.plan, offer.offer) };
  }

  if (input.annual === false) return { ok: false, error: WEEKLY_PLAN_RETIRED_MESSAGE };

  return { ok: true, plan: 'monthly', withTrial, ...attribution, ...withOffer('monthly', offer.offer) };
}

/**
 * The metadata every Stripe object of a checkout carries (the session, the
 * subscription, the payment intent): who bought what, and where in the app
 * the purchase started. The webhook reads `source`/`entry` back into
 * `subscription_started` and `onboarding_completed`.
 */
export function checkoutMetadata(
  userId: string,
  plan: PurchasePlan,
  attribution: CheckoutAttribution
): Record<string, string> {
  const metadata: Record<string, string> = { user_id: userId, plan };
  if (attribution.source) metadata.source = attribution.source;
  if (attribution.entry) metadata.entry = attribution.entry;
  return metadata;
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
  /** Which button started the checkout, and how the visitor reached /generate. */
  source?: CheckoutSource;
  entry?: GenerateEntry;
  /** Unix seconds; defaults to now. Injected so the expiry is testable. */
  nowSeconds?: number;
  /**
   * An offer to apply, with the Stripe promotion code id it resolved to
   * (lib/checkout-offers-stripe.ts). Both or neither: without the id the
   * session is a plain one with the promotion code box.
   */
  offer?: CheckoutOfferId;
  promotionCodeId?: string | null;
}

/**
 * How long a Checkout Session stays open. Stripe rejects an `expires_at`
 * outside 30 minutes .. 24 hours *as measured by Stripe's clock at
 * creation*, so exactly 24h fails the whole checkout whenever this server's
 * clock runs even a second ahead of Stripe's. Five minutes under the
 * maximum keeps the visitor the whole day and the request valid under any
 * realistic skew; the recovery email (`checkout.session.expired` with
 * `after_expiration.recovery`) goes out the moment it lapses.
 */
export const CHECKOUT_SESSION_TTL_SECONDS = 24 * 60 * 60 - 5 * 60;
export const CHECKOUT_SESSION_MIN_TTL_SECONDS = 30 * 60;
export const CHECKOUT_SESSION_MAX_TTL_SECONDS = 24 * 60 * 60;

/**
 * The Checkout Session parameters for a plan. Subscription plans carry the
 * user id on the subscription (the webhook keys on it); the credit pack
 * carries the credit count on the session instead, and the generation
 * credit its count under `generation_credits` (the two one-off products are
 * granted independently by the webhook).
 */
export function buildCheckoutSessionParams(
  input: CheckoutSessionInput
): Stripe.Checkout.SessionCreateParams {
  const { plan, priceId, userId, customerId, email, origin, withTrial } = input;
  const nowSeconds = input.nowSeconds ?? Math.floor(Date.now() / 1000);
  const metadata = checkoutMetadata(userId, plan, { source: input.source, entry: input.entry });
  const discounted = !!input.offer && !!input.promotionCodeId;
  if (discounted) metadata.offer = input.offer!;

  const params: Stripe.Checkout.SessionCreateParams = {
    line_items: [{ price: priceId, quantity: 1 }],
    mode: isSubscriptionPlan(plan) ? 'subscription' : 'payment',
    success_url: isGenerationPlan(plan)
      ? `${origin}/generate?purchased=1`
      : `${origin}/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: isSubscriptionPlan(plan)
      ? `${origin}/onboarding?canceled=true`
      : isGenerationPlan(plan)
        ? `${origin}/generate`
        : `${origin}/settings?canceled=true`,
    automatic_tax: { enabled: true },
    allow_promotion_codes: true,
    locale: 'auto',
    metadata,
    // Abandoned-checkout recovery: when the session expires unpaid Stripe
    // attaches a recovery URL to it and sends checkout.session.expired; the
    // webhook emails that URL (lib/lifecycle/billing-recovery.ts).
    expires_at: nowSeconds + CHECKOUT_SESSION_TTL_SECONDS,
    after_expiration: { recovery: { enabled: true, allow_promotion_codes: true } },
  };

  if (discounted) {
    // Stripe refuses `discounts` together with `allow_promotion_codes`
    // (parameters_exclusive). The recovery session's own promotion code box
    // goes too: the API reference does not say whether it may be combined
    // with a prefilled discount, and a refused create would cost the user
    // the discount (the route retries without it). Recovery stays enabled.
    delete params.allow_promotion_codes;
    params.after_expiration = { recovery: { enabled: true } };
    params.discounts = [{ promotion_code: input.promotionCodeId! }];
  }

  if (customerId) {
    params.customer = customerId;
    // Automatic tax needs an address on the customer; let Checkout fill it.
    params.customer_update = { address: 'auto', name: 'auto' };
  } else if (email) {
    params.customer_email = email;
  }

  if (isSubscriptionPlan(plan)) {
    params.subscription_data = { metadata };
    if (withTrial) params.subscription_data.trial_period_days = 3;
  } else {
    params.metadata = isGenerationPlan(plan)
      ? { ...params.metadata, generation_credits: String(GENERATIONS_PER_PURCHASE[plan]) }
      : { ...params.metadata, credits: String(CREDITS_PER_PACK[plan]) };
    params.payment_intent_data = { metadata };
    // So the next purchase reuses the same customer record.
    if (!customerId) params.customer_creation = 'always';
  }

  return params;
}
