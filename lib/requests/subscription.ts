import { createClient } from '@/lib/supabase/client';
import type { CheckoutSource, GenerateEntry, PurchasePlan } from '@/lib/analytics/events';
import type { CancelFeedback } from '@/lib/analytics/events';
import type { PauseMonths, SubscriptionOfferState } from '@/lib/stripe-subscription';
import type { CheckoutOfferId } from '@/lib/checkout-offers';

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
   * Where the checkout was started from. Captured on `checkout_started` by
   * the route and written to the Stripe metadata so the webhook can
   * attribute the sale (`subscription_started`, `onboarding_completed`).
   */
  source?: CheckoutSource;
  /** For a checkout from /generate: how the visitor reached /generate. */
  entry?: GenerateEntry;
  /**
   * A discount from lib/checkout-offers.ts (`/buy?offer=welcome50`). The
   * route applies it when it covers the plan and drops it otherwise.
   */
  offer?: CheckoutOfferId;
  /** Required for `export_single`: the project whose export is unlocked. Ignored otherwise. */
  projectId?: string;
  /**
   * The onboarding plan step with no free path (data/constants.ts
   * ONBOARDING_PAYWALL_REQUIRED): tagged on `checkout_started`.
   */
  onboardingPaywall?: boolean;
  /**
   * An in-app page to continue to after paying (e.g. the project a tools
   * draft became); /success links there instead of the dashboard.
   */
  successPath?: string;
}

/**
 * Starts a Stripe Checkout session and returns its URL. Every upgrade button
 * in the app goes through here. `checkout_started` is captured by the route
 * itself (server side), not here: a browser that blocks analytics scripts
 * still opens sessions, and those were going uncounted.
 */
export const createCheckoutSession = async ({
  plan,
  annual,
  withTrial = false,
  source = 'settings',
  entry,
  offer,
  projectId,
  onboardingPaywall,
  successPath,
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
    body: JSON.stringify({
      ...(plan ? { plan } : { annual }),
      withTrial,
      source,
      entry,
      ...(offer ? { offer } : {}),
      ...(projectId ? { projectId } : {}),
      ...(onboardingPaywall ? { onboardingPaywall: true } : {}),
      ...(successPath ? { successPath } : {}),
      returnPath: `${window.location.pathname}${window.location.search}`,
    }),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || 'Failed to create checkout session');
  }

  return response.text();
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

export function pauseSubscription(
  months: PauseMonths,
  /** The save step's pause: tagged `cancel_save_offer_accepted` server side. */
  saveStep?: { feedback: CancelFeedback }
) {
  return postSubscriptionAction<SubscriptionActionResult & { alreadyPaused: boolean }>(
    '/api/subscription/pause',
    saveStep ? { months, via: 'save_offer', feedback: saveStep.feedback } : { months },
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

/** The save step's 50% off the next payment (`octree_save50_once`). */
export function applySaveOnceOffer(feedback?: CancelFeedback) {
  return postSubscriptionAction<SubscriptionActionResult>(
    '/api/subscription/save-offer',
    feedback ? { feedback } : undefined,
    'Failed to apply the offer'
  );
}

export function cancelSubscription(
  feedback: CancelFeedback,
  comment?: string,
  extra: { missingFeature?: string; saveOfferShown?: boolean } = {}
) {
  return postSubscriptionAction<SubscriptionActionResult & { alreadyCanceled: boolean }>(
    '/api/cancel-subscription',
    { feedback, comment, ...extra },
    'Failed to cancel subscription'
  );
}
