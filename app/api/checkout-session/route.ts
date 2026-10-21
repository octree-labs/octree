import { NextResponse } from 'next/server';
import { headers } from 'next/headers';

import { stripe } from '@/lib/stripe';
import { createClient } from '@/lib/supabase/server';
import { resolveStripeCustomer } from '@/lib/stripe-customer';
import { getOrCreatePrice } from '@/lib/stripe-prices';
import {
  buildCheckoutSessionParams,
  isSubscriptionPlan,
  lookupKeyForPlan,
  resolveCheckoutPlan,
} from '@/lib/checkout-plans';
import { ensureOfferPromotionCode } from '@/lib/checkout-offers-stripe';
import { AnalyticsEvents } from '@/lib/analytics/events';
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
 * `offer` names a discount from lib/checkout-offers.ts (`welcome50`, the
 * warm_lead_offer email's link). An unknown id is a 400; a known one for a
 * plan it does not cover (the credit pack) is dropped. A valid one opens the
 * session with its promotion code applied (`discounts`). When Stripe will
 * not apply it (WELCOME50 is first-time-transaction only, so a returning
 * customer is refused) the session is opened again without it: the user
 * always reaches checkout.
 *
 * Prices are looked up by Stripe `lookup_key` and created on first use
 * (lib/stripe-prices.ts). When the user already has a Stripe customer
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
    const origin = headersList.get('origin');

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

    const lookupKey = lookupKeyForPlan(resolved.plan);
    const [priceId, customer, promotionCodeId] = await Promise.all([
      getOrCreatePrice(lookupKey, stripe),
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
      origin: origin ?? '',
      withTrial: resolved.withTrial,
      source: resolved.source,
      entry: resolved.entry,
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
      if (!offerApplied || !isStripeInvalidRequest(error)) throw error;
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
      session_id: session.id,
      captured: 'server',
      ...(resolved.offer ? { offer: offerApplied ? resolved.offer : undefined, offer_applied: offerApplied } : {}),
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

/**
 * A 400 from Stripe (StripeInvalidRequestError): a refused promotion code is
 * one (`promotion_code_not_valid`, `coupon_expired`, `resource_missing`, the
 * first-time-transaction check). Retrying such a request without the
 * discount is safe; a network or auth error is rethrown as before.
 */
function isStripeInvalidRequest(error: unknown): boolean {
  const e = error as { type?: string; statusCode?: number } | null;
  return e?.type === 'StripeInvalidRequestError' || e?.statusCode === 400;
}
