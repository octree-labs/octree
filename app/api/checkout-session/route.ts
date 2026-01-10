import { NextResponse } from 'next/server';
import { headers } from 'next/headers';

import { stripe } from '@/lib/stripe';
import { createClient } from '@/lib/supabase/server';
import { STRIPE_PRICE_IDS } from '@/lib/stripe-config';

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

    let body;
    try {
      body = await request.json();
    } catch (parseError) {
      body = {};
    }

    const isAnnual = body.annual === true;
    const withTrial = body.withTrial === true;

    const priceId = isAnnual
      ? STRIPE_PRICE_IDS.proAnnual
      : STRIPE_PRICE_IDS.pro;

    const sessionConfig: Stripe.Checkout.SessionCreateParams = {
      line_items: [
        {
          price: priceId,
          quantity: 1,
        },
      ],
      mode: 'subscription',
      success_url: `${origin}/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/onboarding?canceled=true`,
      automatic_tax: { enabled: true },
      customer_email: user.email,
      metadata: {
        user_id: user.id,
      },
    };

    // Only add trial period if explicitly requested
    if (withTrial) {
      sessionConfig.subscription_data = {
        trial_period_days: 3,
        metadata: {
          user_id: user.id,
        },
      };
    } else {
      sessionConfig.subscription_data = {
        metadata: {
          user_id: user.id,
        },
      };
    }

    const session = await stripe.checkout.sessions.create(sessionConfig);

    if (!session.url) {
      throw new Error('No session URL');
    }

    return new NextResponse(session.url, { status: 200 });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || 'An error occurred' },
      { status: err?.statusCode || 500 }
    );
  }
}
