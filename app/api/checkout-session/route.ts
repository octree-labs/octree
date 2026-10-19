import { NextResponse } from 'next/server';
import { headers } from 'next/headers';

import { stripe } from '@/lib/stripe';
import { createClient } from '@/lib/supabase/server';
import { resolveStripeCustomer } from '@/lib/stripe-customer';
import { getOrCreatePrice } from '@/lib/stripe-prices';
import {
  buildCheckoutSessionParams,
  lookupKeyForPlan,
  resolveCheckoutPlan,
} from '@/lib/checkout-plans';
import { captureServerExceptionAfterResponse } from '@/lib/posthog-server';

/**
 * Starts a Stripe Checkout Session.
 *
 * Body: `{ plan: 'monthly' | 'annual' | 'semester' | 'credits_100', withTrial?,
 * source?, entry? }`. `source` (which button) and `entry` (how /generate was
 * reached) are attribution only: validated, written to the Stripe metadata
 * and read back by the webhook; an unknown value is dropped, not refused.
 * The legacy `{ annual: true }` body (older clients) still buys the monthly
 * plan; `annual: false` / `plan: 'weekly'` asked for the retired weekly plan
 * and gets a 400. See lib/checkout-plans.ts for the mapping.
 *
 * Prices are looked up by Stripe `lookup_key` and created on first use
 * (lib/stripe-prices.ts). When the user already has a Stripe customer
 * (user_usage.stripe_customer_id, or found by email) the session is opened
 * on it so one user stays one customer.
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

    const [priceId, customer] = await Promise.all([
      getOrCreatePrice(lookupKeyForPlan(resolved.plan), stripe),
      resolveStripeCustomer(supabase, user).catch((error) => {
        console.error('Could not resolve Stripe customer for checkout:', error);
        return null;
      }),
    ]);

    const sessionConfig = buildCheckoutSessionParams({
      plan: resolved.plan,
      priceId,
      userId: user.id,
      customerId: customer?.customerId ?? null,
      email: user.email,
      origin: origin ?? '',
      withTrial: resolved.withTrial,
      source: resolved.source,
      entry: resolved.entry,
    });

    const session = await stripe.checkout.sessions.create(sessionConfig);

    if (!session.url) {
      throw new Error('No session URL');
    }

    return new NextResponse(session.url, { status: 200 });
  } catch (err: any) {
    captureServerExceptionAfterResponse(err, { route: 'api/checkout-session' });
    return NextResponse.json(
      { error: err?.message || 'An error occurred' },
      { status: err?.statusCode || 500 }
    );
  }
}
