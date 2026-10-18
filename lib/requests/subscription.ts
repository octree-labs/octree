import { createClient } from '@/lib/supabase/client';
import {
  AnalyticsEvents,
  checkoutPlanFromAnnualFlag,
  type CheckoutSource,
} from '@/lib/analytics/events';
import { track } from '@/lib/analytics/track';

interface CreateCheckoutSessionOptions {
  annual?: boolean;
  withTrial?: boolean;
  /** Where the checkout was started from; only used for analytics. */
  source?: CheckoutSource;
}

/**
 * Starts a Stripe Checkout session and returns its URL. Every upgrade button
 * in the app goes through here, so `checkout_started` is captured in one
 * place (before the redirect, so it is never lost to the navigation).
 */
export const createCheckoutSession = async ({
  annual = false,
  withTrial = false,
  source = 'settings',
}: CreateCheckoutSessionOptions = {}): Promise<string> => {
  const supabase = createClient();

  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session?.user) {
    throw new Error('User not authenticated');
  }

  const response = await fetch('/api/checkout-session', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ annual, withTrial }),
  });

  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(errorData.error || 'Failed to create checkout session');
  }

  const checkoutUrl = await response.text();

  track(AnalyticsEvents.CHECKOUT_STARTED, {
    plan: checkoutPlanFromAnnualFlag(annual),
    source,
    with_trial: withTrial,
  });

  return checkoutUrl;
};
