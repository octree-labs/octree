import { createClient } from '@/lib/supabase/client';
import {
  AnalyticsEvents,
  checkoutPlanFromAnnualFlag,
  type CheckoutSource,
  type GenerateEntry,
  type PurchasePlan,
} from '@/lib/analytics/events';
import { track } from '@/lib/analytics/track';
import type { CancelFeedback } from '@/lib/analytics/events';
import type { PauseMonths, SubscriptionOfferState } from '@/lib/stripe-subscription';

export type CheckoutPlanRequest = Exclude<PurchasePlan, 'weekly'>;

interface CreateCheckoutSessionOptions {
  /** What to buy. Preferred over the legacy `annual` flag. */
  plan?: CheckoutPlanRequest;
  /**
   * Legacy flag: `true` is the $9.99/month plan. `false` used to be the
   * weekly plan, which the API now refuses; new callers pass `plan`.
   */
  annual?: boolean;
  withTrial?: boolean;
  /**
   * Where the checkout was started from. Captured on `checkout_started`
   * and written to the Stripe metadata so the webhook can attribute the
   * sale (`subscription_started`, `onboarding_completed`).
   */
  source?: CheckoutSource;
  /** For a checkout from /generate: how the visitor reached /generate. */
  entry?: GenerateEntry;
}

/**
 * Starts a Stripe Checkout session and returns its URL. Every upgrade button
 * in the app goes through here, so `checkout_started` is captured in one
 * place (before the redirect, so it is never lost to the navigation).
 */
export const createCheckoutSession = async ({
  plan,
  annual,
  withTrial = false,
  source = 'settings',
  entry,
}: CreateCheckoutSessionOptions = {}): Promise<string> => {
  const supabase = createClient();

  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session?.user) {
    throw new Error('User not authenticated');
  }

  // Without either flag the API sells the monthly plan; mirror that here.
  const requested: PurchasePlan =
    plan ?? (annual === undefined ? 'monthly' : checkoutPlanFromAnnualFlag(annual));

  const response = await fetch('/api/checkout-session', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ ...(plan ? { plan } : { annual }), withTrial, source, entry }),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || 'Failed to create checkout session');
  }

  const checkoutUrl = await response.text();

  track(AnalyticsEvents.CHECKOUT_STARTED, {
    plan: requested,
    source,
    with_trial: withTrial,
  });

  return checkoutUrl;
};

async function postSubscriptionAction<T>(
  path: string,
  body?: Record<string, unknown>,
  fallbackError = 'Request failed'
): Promise<T> {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || fallbackError);
  }
  return data as T;
}

export interface SubscriptionActionResult {
  success: true;
  subscription: {
    id: string;
    status: string;
    cancel_at_period_end: boolean;
    current_period_end: number;
    paused_until: number | null;
    /** While paused: unix seconds until which Pro stays on. */
    pause_paid_through: number | null;
  };
}

/** The save offers that still apply; also captures `cancel_flow_opened`. */
export async function fetchCancelOffers(): Promise<SubscriptionOfferState> {
  const response = await fetch('/api/subscription/offers');
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || 'Failed to load subscription');
  }
  return data.subscription as SubscriptionOfferState;
}

export function pauseSubscription(months: PauseMonths) {
  return postSubscriptionAction<SubscriptionActionResult & { alreadyPaused: boolean }>(
    '/api/subscription/pause',
    { months },
    'Failed to pause subscription'
  );
}

export function resumeSubscription() {
  return postSubscriptionAction<SubscriptionActionResult & { alreadyActive: boolean }>(
    '/api/subscription/resume',
    undefined,
    'Failed to resume subscription'
  );
}

export function applySaveDiscount() {
  return postSubscriptionAction<SubscriptionActionResult>(
    '/api/subscription/discount',
    undefined,
    'Failed to apply discount'
  );
}

export function cancelSubscription(feedback: CancelFeedback, comment?: string) {
  return postSubscriptionAction<SubscriptionActionResult & { alreadyCanceled: boolean }>(
    '/api/cancel-subscription',
    { feedback, comment },
    'Failed to cancel subscription'
  );
}
