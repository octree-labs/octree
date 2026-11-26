import { NextResponse } from 'next/server';
import { headers } from 'next/headers';

import { stripe } from '@/lib/stripe';
import { createClient } from '@/lib/supabase/server';
import { resolveStripeCustomer } from '@/lib/stripe-customer';
import { getOrCreatePrice } from '@/lib/stripe-prices';
import {
  buildCheckoutSessionParams,
  isPassPlan,
  isSubscriptionPlan,
  lookupKeyForPlan,
  resolveCheckoutPlan,
} from '@/lib/checkout-plans';
import { ensureOfferPromotionCode } from '@/lib/checkout-offers-stripe';
import { countryFromHeaders, priceTierForCountry } from '@/lib/regional-pricing';
import { EXPORT_ALREADY_UNLOCKED_MESSAGE, readExportUnlocked } from '@/lib/export-unlock';
import { AnalyticsEvents } from '@/lib/analytics/events';
import { hasLiveSubscription, passTrialEnd, type BillingRow } from '@/lib/subscription/pass-trial';
import {
  captureServerEventAfterResponse,
  captureServerExceptionAfterResponse,
} from '@/lib/posthog-server';

/**
 * Starts a Stripe Checkout Session.
 *
 * Body: `{ plan: 'monthly' | 'annual' | 'semester' | 'credits_100', withTrial?,
 * source?, entry?, offer? }`. `source` (which button) and `entry` (how /generate was
 * reached) are attribution only: validated, written to the Stripe metadata
 * and read back by the webhook; an unknown value is dropped, not refused.
 * The legacy `{ annual: true }` body (older clients) still buys the monthly
 * plan; `annual: false` / `plan: 'weekly'` asked for the retired weekly plan
 * and gets a 400. See lib/checkout-plans.ts for the mapping.
 *
 * `successPath` (an in-app path, `resolveReturnPath`) is where /success
 * continues to after a subscription is paid; the onboarding paywall sends
 * the page the user was headed for (a tools draft's project, /generate).
 * `onboardingPaywall: true` with `source: 'onboarding'` tags
 * `checkout_started` with `onboarding_paywall`.
 *
 * `offer` names a discount from lib/checkout-offers.ts (`welcome50`, the
 * warm_lead_offer email's link). An unknown id is a 400; a known one for a
 * plan it does not cover (welcome50 is monthly only) is dropped. A valid one opens the
 * session with its promotion code applied (`discounts`). When Stripe will
 * not apply it (WELCOME50 is first-time-transaction only, so a returning
 * customer is refused) the session is opened again without it: the user
 * always reaches checkout.
 *
 * `plan: 'export_single'` also takes `projectId` (required, a uuid): the
 * project whose export the $4.99 purchase unlocks. It is read with the
 * user's own client (RLS) and filtered on `user_id`, so a project that is
 * not theirs, or does not exist, is a 404 and no session is opened; a
 * project already unlocked is a 409 (it cannot be bought twice).
 *
 * Prices are looked up by Stripe `lookup_key` and created on first use
 * (lib/stripe-prices.ts). The visitor's country (Vercel's IP country header)
 * picks the regional price tier (lib/regional-pricing.ts): the same rule GET
 * /api/pricing gives the browser, so the price shown is the price charged. When the user already has a Stripe customer
 * (user_usage.stripe_customer_id, or found by email) the session is opened
 * on it so one user stays one customer.
 *
 * `checkout_started` is captured here, server side, once Stripe has opened
 * the session: a browser that blocks analytics scripts still reaches this
 * route, so the event cannot be lost the way a client capture is.
 */
export async function POST(request: Request) {
  try {
    const headersList = await headers();
    // Browsers send Origin on a POST, but a client that does not (a privacy
    // extension, a proxy stripping it) would otherwise get relative
    // success/cancel URLs, which Stripe refuses: the user never reaches
    // checkout. Fall back to the request's own origin.
    const origin = headersList.get('origin') || new URL(request.url).origin;

    const supabase = await createClient();

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      body = {};
    }

    const resolved = resolveCheckoutPlan(body);
    if (!resolved.ok) {
      return NextResponse.json({ error: resolved.error }, { status: 400 });
    }

    // The onboarding plan step can be reached again while a payment is still
    // landing (webhook lag, a back button from Stripe, a second tab, a
    // delayed payment method): a second subscription would be charged.
    if (
      resolved.source === 'onboarding' &&
      isSubscriptionPlan(resolved.plan) &&
      (await hasSubscriptionInFlight(supabase, user.id))
    ) {
      return NextResponse.json({ error: ALREADY_SUBSCRIBED_MESSAGE }, { status: 409 });
    }

    // A Deadline Pass on top of a live (active/trialing) subscription buys
    // nothing: they are Pro already. A failed renewal (past_due, unpaid,
    // incomplete) or a stale is_pro does not block it: that user is not Pro.
    const billingRow =
      isPassPlan(resolved.plan) || isSubscriptionPlan(resolved.plan) ? await readBillingRow(supabase, user.id) : null;
    if (isPassPlan(resolved.plan) && hasLiveSubscription(billingRow)) {
      return NextResponse.json({ error: PASS_WHILE_SUBSCRIBED_MESSAGE }, { status: 409 });
    }
    // Subscribing while a Deadline Pass runs: billing starts when the pass
    // ends (trial_end), computed from the database row, never the client.
    const trialEnd = isSubscriptionPlan(resolved.plan) ? passTrialEnd(billingRow?.pro_until) : null;

    if (resolved.projectId) {
      const { data: project, error: projectError } = await supabase
        .from('projects')
        .select('id')
        .eq('id', resolved.projectId)
        .eq('user_id', user.id)
        .maybeSingle();
      if (projectError) throw projectError;
      if (!project) {
        return NextResponse.json({ error: 'Project not found' }, { status: 404 });
      }
      // project_id is unique in project_export_unlocks: a second payment for
      // an unlocked project would be charged and grant nothing. (The paywall
      // does not open for an unlocked project, but a stale tab, a second
      // tab or a direct call can still get here.)
      if (await readExportUnlocked(supabase, resolved.projectId)) {
        return NextResponse.json({ error: EXPORT_ALREADY_UNLOCKED_MESSAGE }, { status: 409 });
      }
    }

    const lookupKey = lookupKeyForPlan(resolved.plan);
    const country = countryFromHeaders(headersList);
    let priceTier = priceTierForCountry(country);
    const [priceId, customer, promotionCodeId] = await Promise.all([
      // A regional price that cannot be resolved (Stripe hiccup, creation
      // refused) must not cost the visitor their checkout: open it at the
      // list price instead, which Stripe shows them before they pay.
      getOrCreatePrice(lookupKey, stripe, priceTier).catch((error) => {
        if (priceTier === 'standard') throw error;
        console.error(`[checkout] regional price ${priceTier} for ${lookupKey} failed; using list price:`, error);
        priceTier = 'standard';
        return getOrCreatePrice(lookupKey, stripe);
      }),
      resolveStripeCustomer(supabase, user).catch((error) => {
        console.error('Could not resolve Stripe customer for checkout:', error);
        return null;
      }),
      resolved.offer ? ensureOfferPromotionCode(resolved.offer, stripe) : Promise.resolve(null),
    ]);

    const sessionInput = {
      plan: resolved.plan,
      priceId,
      userId: user.id,
      customerId: customer?.customerId ?? null,
      email: user.email,
      origin,
      withTrial: resolved.withTrial,
      source: resolved.source,
      entry: resolved.entry,
      ...(resolved.projectId ? { projectId: resolved.projectId } : {}),
      ...(resolved.returnPath ? { returnPath: resolved.returnPath } : {}),
      ...(resolved.successPath ? { successPath: resolved.successPath } : {}),
      priceTier,
      country,
      ...(trialEnd ? { trialEnd } : {}),
    };
    let offerApplied = !!resolved.offer && !!promotionCodeId;
    if (resolved.offer && !promotionCodeId) {
      console.warn(`[checkout] offer ${resolved.offer} has no promotion code; opening checkout without it`);
    }

    let session;
    try {
      session = await stripe.checkout.sessions.create(
        buildCheckoutSessionParams(
          offerApplied ? { ...sessionInput, offer: resolved.offer, promotionCodeId } : sessionInput
        )
      );
    } catch (error) {
      if (!offerApplied || !isRefusedDiscount(error)) throw error;
      // The promotion code was refused (first-time-transaction restriction,
      // code deactivated, ...): the user still gets a checkout, at full price.
      console.warn(
        `[checkout] Stripe refused offer ${resolved.offer}; retrying without it:`,
        (error as { code?: string; message?: string }).code ?? (error as Error).message
      );
      offerApplied = false;
      session = await stripe.checkout.sessions.create(buildCheckoutSessionParams(sessionInput));
    }

    if (!session.url) {
      throw new Error('No session URL');
    }

    captureServerEventAfterResponse(user.id, AnalyticsEvents.CHECKOUT_STARTED, {
      plan: resolved.plan,
      source: resolved.source ?? 'unknown',
      entry: resolved.entry,
      with_trial: resolved.withTrial,
      mode: isSubscriptionPlan(resolved.plan) ? 'subscription' : 'payment',
      price_lookup_key: lookupKey,
      price_tier: priceTier,
      country,
      session_id: session.id,
      captured: 'server',
      ...(trialEnd ? { trial_until_pass_end: true } : {}),
      ...(resolved.offer ? { offer: offerApplied ? resolved.offer : undefined, offer_applied: offerApplied } : {}),
      ...(isOnboardingPaywallCheckout(body, resolved.source) ? { onboarding_paywall: true } : {}),
    });

    return new NextResponse(session.url, { status: 200 });
  } catch (err: any) {
    captureServerExceptionAfterResponse(err, { route: 'api/checkout-session' });
    return NextResponse.json(
      { error: err?.message || 'An error occurred' },
      { status: err?.statusCode || 500 }
    );
  }
}

const ALREADY_SUBSCRIBED_MESSAGE =
  'You already have an Octree Pro subscription (it can take a minute to activate). Refresh the page in a moment.';

const PASS_WHILE_SUBSCRIBED_MESSAGE =
  'You already have Octree Pro through your subscription, so a Deadline Pass would add nothing.';

/** The billing columns the pass guard and the pass trial read. Null on any error (never blocks a sale). */
async function readBillingRow(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string
): Promise<BillingRow | null> {
  try {
    const { data } = await (supabase.from('user_usage') as any)
      .select('subscription_status, stripe_subscription_id, current_period_end, pro_until')
      .eq('user_id', userId)
      .maybeSingle();
    return (data as BillingRow | null) ?? null;
  } catch (error) {
    console.error('[checkout] could not read the billing row:', error);
    return null;
  }
}

/** Subscription states in which another onboarding checkout would charge twice. */
const IN_FLIGHT_SUBSCRIPTION_STATUSES = new Set(['active', 'trialing', 'incomplete', 'past_due']);

/**
 * Whether the user is Pro already or has a subscription Stripe is still
 * settling. A failed read lets the checkout through (never blocks a sale).
 */
async function hasSubscriptionInFlight(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string
): Promise<boolean> {
  try {
    const { data } = await (supabase.from('user_usage') as any)
      .select('is_pro, subscription_status')
      .eq('user_id', userId)
      .maybeSingle();
    if (!data) return false;
    return !!data.is_pro || IN_FLIGHT_SUBSCRIPTION_STATUSES.has(data.subscription_status ?? '');
  } catch (error) {
    console.error('[checkout] could not read the subscription state:', error);
    return false;
  }
}

/** The onboarding plan step with no free path (`onboardingPaywall` in the body). */
function isOnboardingPaywallCheckout(body: unknown, source: string | undefined): boolean {
  return (
    source === 'onboarding' &&
    !!body &&
    typeof body === 'object' &&
    (body as Record<string, unknown>).onboardingPaywall === true
  );
}

/**
 * Whether a failed create may be retried without the discount: only a
 * StripeInvalidRequestError (HTTP 400). A refused promotion code is one:
 * `promotion_code_customer_not_first_time` (the customer has prior
 * payments; WELCOME50 is first-time only), `coupon_expired`,
 * `resource_missing` (https://docs.stripe.com/error-codes). The retry is
 * kept broad within 400s on purpose: a 400 unrelated to the discount fails
 * the retry too and surfaces as before, while an unlisted refusal code
 * would otherwise cost the user their checkout. Auth (401), permission
 * (403), idempotency, rate-limit (429), connection and API (5xx) errors are
 * never retried.
 */
function isRefusedDiscount(error: unknown): boolean {
  const e = error as { type?: string; statusCode?: number } | null;
  if (e?.type !== 'StripeInvalidRequestError') return false;
  return e.statusCode === undefined || e.statusCode === 400;
}
