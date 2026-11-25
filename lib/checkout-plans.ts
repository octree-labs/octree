import type Stripe from 'stripe';

import {
  isCheckoutSource,
  isGenerateEntry,
  type CheckoutSource,
  type GenerateEntry,
} from '@/lib/analytics/events';
import { PRICE_LOOKUP_KEYS, type PriceLookupKey } from '@/lib/stripe-prices';
import { isCheckoutOfferId, offerAppliesToPlan, type CheckoutOfferId } from '@/lib/checkout-offers';
import type { PriceTier } from '@/lib/regional-pricing';

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
 * - `export_single`: a $4.99 unlock of PDF/ZIP export for ONE project,
 *   forever (`mode: 'payment'`, `metadata.export_project_id`; the webhook
 *   writes project_export_unlocks through grant_export_unlock and the buyer
 *   lands back on the project with `?export=unlocked`). Requires a
 *   `projectId` the signed-in user owns (the route checks it).
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

export const EXPORT_PLANS = ['export_single'] as const;
export type ExportPlan = (typeof EXPORT_PLANS)[number];

export type PurchasePlan = SubscriptionPlan | CreditPlan | GenerationPlan | ExportPlan;

export const PURCHASE_PLANS: readonly PurchasePlan[] = [
  ...SUBSCRIPTION_PLANS,
  ...CREDIT_PLANS,
  ...GENERATION_PLANS,
  ...EXPORT_PLANS,
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

export function isExportPlan(plan: PurchasePlan): plan is ExportPlan {
  return (EXPORT_PLANS as readonly string[]).includes(plan);
}

/** Project ids are Supabase uuids; anything else is refused before a query. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isProjectId(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value);
}

export const EXPORT_PROJECT_REQUIRED_MESSAGE = 'export_single needs the projectId of one of your projects.';

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

const RETURN_PATH_MAX_LENGTH = 512;
const RETURN_PATH_BASE = 'https://return-path.invalid';
const RETURN_PATH_BLOCKED_PREFIXES = ['/api/', '/auth/', '/checkout/', '/success'];

/**
 * The in-app page a checkout was started from, where Stripe's back link
 * returns the buyer. Only a same-origin path (with its query) is kept;
 * anything that could leave the app (`//host`, `/\\host`, an absolute URL),
 * an API, auth or checkout route, or an over-long value is dropped, never
 * refused: the checkout then returns to the plan's default page.
 */
export function resolveReturnPath(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length > RETURN_PATH_MAX_LENGTH) return undefined;
  if (!value.startsWith('/') || value.startsWith('//') || value.includes('\\')) return undefined;
  if (/[\u0000-\u001f]/.test(value)) return undefined;
  let url: URL;
  try {
    url = new URL(value, RETURN_PATH_BASE);
  } catch {
    return undefined;
  }
  if (url.origin !== RETURN_PATH_BASE) return undefined;
  if (RETURN_PATH_BLOCKED_PREFIXES.some((prefix) => url.pathname.startsWith(prefix))) return undefined;
  return `${url.pathname}${url.search}`;
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
      /**
       * `export_single` only: the project to unlock (a uuid; ownership is
       * the route's check). Ignored, and absent, for every other plan.
       */
      projectId?: string;
      /** Where Stripe's back link returns the buyer (`resolveReturnPath`). */
      returnPath?: string;
      /** Where /success sends the buyer on to (`resolveReturnPath`); subscription plans only. */
      successPath?: string;
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
  const returnPath = resolveReturnPath(input.returnPath);
  const successPath = resolveReturnPath(input.successPath);
  const attribution = {
    ...resolveCheckoutAttribution(input),
    ...(returnPath ? { returnPath } : {}),
    ...(successPath ? { successPath } : {}),
  };
  const offer = resolveOffer(input.offer);
  if (!offer.ok) return offer;

  if (input.plan !== undefined) {
    if (input.plan === 'weekly') return { ok: false, error: WEEKLY_PLAN_RETIRED_MESSAGE };
    if (!isPurchasePlan(input.plan)) {
      return { ok: false, error: `Unknown plan: ${String(input.plan)}` };
    }
    if (isExportPlan(input.plan)) {
      if (!isProjectId(input.projectId)) return { ok: false, error: EXPORT_PROJECT_REQUIRED_MESSAGE };
      return {
        ok: true,
        plan: input.plan,
        withTrial,
        ...attribution,
        ...withOffer(input.plan, offer.offer),
        projectId: input.projectId,
      };
    }
    return { ok: true, plan: input.plan, withTrial, ...attribution, ...withOffer(input.plan, offer.offer) };
  }

  if (input.annual === false) return { ok: false, error: WEEKLY_PLAN_RETIRED_MESSAGE };

  return { ok: true, plan: 'monthly', withTrial, ...attribution, ...withOffer('monthly', offer.offer) };
}

/** `metadata.app` on every Stripe object Octree's checkout creates. */
export const OCTREE_STRIPE_APP = 'octree';

/**
 * The metadata every Stripe object of a checkout carries (the session, the
 * subscription, the payment intent): who bought what, and where in the app
 * the purchase started. The webhook reads `source`/`entry` back into
 * `subscription_started` and `onboarding_completed`.
 *
 * `app: 'octree'` tags the object as Octree's. The Stripe account is shared
 * with another product whose webhook endpoint receives the same events (and
 * ours receives theirs); the webhook ignores anything not tagged as ours
 * (`isOctreeCheckoutSession` / `isOctreeSubscription` in
 * lib/stripe-webhook.ts, which also cover objects created before the tag).
 */
export function checkoutMetadata(
  userId: string,
  plan: PurchasePlan,
  attribution: CheckoutAttribution
): Record<string, string> {
  const metadata: Record<string, string> = { app: OCTREE_STRIPE_APP, user_id: userId, plan };
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
  /** `export_single` only: the (ownership-checked) project to unlock. */
  projectId?: string;
  /** The page the checkout was started from (`resolveReturnPath`). */
  returnPath?: string;
  /**
   * Subscription plans: the page /success continues to (`resolveReturnPath`),
   * e.g. the project a tools draft became when the buyer was sent through
   * the onboarding paywall. Without it /success offers the dashboard.
   */
  successPath?: string;
  /**
   * The regional price tier `priceId` belongs to (lib/regional-pricing.ts)
   * and the country it was chosen from; written to the metadata so a
   * regional sale can be told apart. Omitted for the list price.
   */
  priceTier?: PriceTier;
  country?: string | null;
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
 * Where the buyer lands after leaving Checkout with its back link: the
 * project for an export unlock (the purchase is tied to it), otherwise the
 * page the checkout was started from, falling back to /generate for a
 * generation credit and to the billing page (which says no charge was made)
 * for everything else.
 */
export function cancelReturnPath(plan: PurchasePlan, returnPath: string | undefined, projectId: string | undefined): string {
  if (projectId) return `/projects/${projectId}`;
  if (returnPath) return returnPath;
  return isGenerationPlan(plan) ? '/generate' : '/settings/billing?canceled=true';
}

/**
 * Stripe's back link goes through app/checkout/canceled, which records
 * `checkout_canceled` and redirects to `returnPath`.
 */
export function checkoutCanceledUrl(
  origin: string,
  plan: PurchasePlan,
  source: CheckoutSource | undefined,
  returnPath: string
): string {
  const params = new URLSearchParams({ to: returnPath, plan });
  if (source) params.set('source', source);
  return `${origin}/checkout/canceled?${params.toString()}`;
}

/**
 * /success for a subscription or the credit pack. `{CHECKOUT_SESSION_ID}` is
 * Stripe's template and must stay unencoded; `next` is a validated in-app path.
 */
function successUrl(origin: string, successPath: string | undefined): string {
  const base = `${origin}/success?session_id={CHECKOUT_SESSION_ID}`;
  return successPath ? `${base}&next=${encodeURIComponent(successPath)}` : base;
}

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
  if (input.priceTier && input.priceTier !== 'standard') {
    metadata.price_tier = input.priceTier;
    if (input.country) metadata.country = input.country;
  }
  const discounted = !!input.offer && !!input.promotionCodeId;
  if (discounted) metadata.offer = input.offer!;
  const exportProjectId = isExportPlan(plan) ? input.projectId : undefined;
  if (isExportPlan(plan) && !exportProjectId) {
    throw new Error(EXPORT_PROJECT_REQUIRED_MESSAGE);
  }
  // On the session AND the payment intent, so the unlock can be traced from
  // either Stripe object.
  if (exportProjectId) metadata.export_project_id = exportProjectId;
  const projectUrl = exportProjectId ? `${origin}/projects/${exportProjectId}` : null;

  const params: Stripe.Checkout.SessionCreateParams = {
    line_items: [{ price: priceId, quantity: 1 }],
    mode: isSubscriptionPlan(plan) ? 'subscription' : 'payment',
    success_url: projectUrl
      ? `${projectUrl}?export=unlocked`
      : isGenerationPlan(plan)
        ? `${origin}/generate?purchased=1`
        : successUrl(origin, isSubscriptionPlan(plan) ? input.successPath : undefined),
    cancel_url: checkoutCanceledUrl(origin, plan, input.source, cancelReturnPath(plan, input.returnPath, exportProjectId)),
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
    // Each one-off carries only its own key, so the webhook grants exactly
    // one product per session (export_single: export_project_id, above).
    params.metadata = isGenerationPlan(plan)
      ? { ...params.metadata, generation_credits: String(GENERATIONS_PER_PURCHASE[plan]) }
      : isExportPlan(plan)
        ? { ...params.metadata }
        : { ...params.metadata, credits: String(CREDITS_PER_PACK[plan]) };
    params.payment_intent_data = { metadata };
    // So the next purchase reuses the same customer record.
    if (!customerId) params.customer_creation = 'always';
  }

  return params;
}
