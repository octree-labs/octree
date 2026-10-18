'use client';

/**
 * Browser-side PostHog wrappers. Every call is a no-op until
 * `posthog.init` has run (components/providers/posthog.tsx), which only
 * happens when NEXT_PUBLIC_POSTHOG_KEY is set, so dev and tests never send
 * anything and never throw.
 */

import posthog from 'posthog-js';

import type { AnalyticsEvent, AnalyticsEventProperties } from './events';

function isReady(): boolean {
  return typeof window !== 'undefined' && Boolean(posthog.__loaded);
}

export function track<E extends AnalyticsEvent>(
  event: E,
  properties: AnalyticsEventProperties[E]
): void {
  if (!isReady()) return;
  try {
    posthog.capture(event, properties);
  } catch (error) {
    console.error('PostHog capture failed:', error);
  }
}

/** `true` for 1 in `rate` calls; used to cap the volume of high-frequency events. */
export function shouldSample(rate: number): boolean {
  if (rate <= 1) return true;
  return Math.floor(Math.random() * rate) === 0;
}

export interface IdentifyTraits {
  email?: string | null;
  provider?: string | null;
  is_pro?: boolean | null;
  subscription_status?: string | null;
  role?: string | null;
  referral_source?: string | null;
  created_at?: string | null;
}

/**
 * Ties the anonymous session to the Supabase user. `$set` keeps the plan
 * state current; `$set_once` pins the acquisition facts to the first value
 * seen so later edits never rewrite them.
 */
export function identifyUser(userId: string, traits: IdentifyTraits): void {
  if (!isReady()) return;
  try {
    const set: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(traits)) {
      if (value !== undefined && value !== null) set[key] = value;
    }
    const setOnce: Record<string, unknown> = {};
    if (traits.created_at) setOnce.signup_date = traits.created_at;
    if (traits.referral_source) setOnce.referral_source = traits.referral_source;

    posthog.identify(userId, set, setOnce);
  } catch (error) {
    console.error('PostHog identify failed:', error);
  }
}

/** Call on sign-out so the next visitor on this browser starts a fresh person. */
export function resetAnalytics(): void {
  if (!isReady()) return;
  try {
    posthog.reset();
  } catch (error) {
    console.error('PostHog reset failed:', error);
  }
}

export function captureClientException(
  error: unknown,
  properties?: Record<string, unknown>
): void {
  if (!isReady()) return;
  try {
    posthog.captureException(error, properties);
  } catch (captureError) {
    console.error('PostHog captureException failed:', captureError);
  }
}
