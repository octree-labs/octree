import { NextResponse } from 'next/server';

import { AnalyticsEvents, isCheckoutSource } from '@/lib/analytics/events';
import { isPurchasePlan, resolveReturnPath } from '@/lib/checkout-plans';
import { captureServerEventAfterResponse } from '@/lib/posthog-server';
import { createClient } from '@/lib/supabase/server';

/**
 * Stripe Checkout's back link (`cancel_url`, lib/checkout-plans.ts). Records
 * `checkout_canceled` for the signed-in buyer, then sends them back to the
 * page the checkout was started from. `to` is validated again here, so this
 * route is never an open redirect; an invalid one returns to the dashboard.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const returnPath = resolveReturnPath(url.searchParams.get('to')) ?? '/';
  const plan = url.searchParams.get('plan');
  const source = url.searchParams.get('source');

  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (user) {
      captureServerEventAfterResponse(user.id, AnalyticsEvents.CHECKOUT_CANCELED, {
        plan: isPurchasePlan(plan) ? plan : 'unknown',
        source: isCheckoutSource(source) ? source : 'unknown',
        return_path: new URL(returnPath, url.origin).pathname,
      });
    }
  } catch (error) {
    console.error('[checkout] could not record checkout_canceled:', error);
  }

  return NextResponse.redirect(new URL(returnPath, url.origin));
}
