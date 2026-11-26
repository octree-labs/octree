import 'server-only';

import { getPostHogServer } from '@/lib/posthog-server';
import {
  DEFAULT_OFFER_VARIANT,
  OFFER_V2_FLAG_KEY,
  offerVariantFromFlag,
  offerVariantOverride,
  type OfferVariant,
} from '@/lib/offer-v2/variant';

/**
 * The user's `onboarding-offer-v2` variant, evaluated server side so the
 * page, the checkout metadata and every event agree.
 *
 * Order: the `NEXT_PUBLIC_OFFER_V2` override; then PostHog's answer for the
 * user id (the same distinct id the app identifies with, so the assignment
 * is sticky and the experiment joins to `paywall_shown` / `checkout_started`
 * / `subscription_started`); `control` when PostHog is not configured,
 * fails, or takes longer than FLAG_TIMEOUT_MS. Never throws.
 *
 * Answers are cached per process for CACHE_TTL_MS: a PostHog assignment is
 * deterministic per distinct id, so the cache only saves round trips (the
 * plan step and the checkout ask within seconds of each other).
 */

const FLAG_TIMEOUT_MS = 1500;
const CACHE_TTL_MS = 10 * 60 * 1000;
const CACHE_MAX = 5000;

const cache = new Map<string, { variant: OfferVariant; expires: number }>();

export function resetOfferVariantCacheForTests(): void {
  cache.clear();
}

type FlagClient = {
  getFeatureFlag(key: string, distinctId: string, options?: Record<string, unknown>): Promise<unknown>;
};

async function evaluateFlag(client: FlagClient, userId: string): Promise<OfferVariant | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), FLAG_TIMEOUT_MS);
  });
  try {
    const value = await Promise.race([
      client.getFeatureFlag(OFFER_V2_FLAG_KEY, userId).catch((error: unknown) => {
        console.error('[offer-v2] flag evaluation failed:', error);
        return undefined;
      }),
      timeout,
    ]);
    // null: timed out (not cached, the next request asks again).
    return value === null ? null : offerVariantFromFlag(value);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function getOfferVariant(
  userId: string,
  options: {
    env?: Record<string, string | undefined>;
    client?: FlagClient | null;
    now?: number;
  } = {}
): Promise<OfferVariant> {
  const env = options.env ?? process.env;
  const forced = offerVariantOverride(env.NEXT_PUBLIC_OFFER_V2);
  if (forced) return forced;

  const now = options.now ?? Date.now();
  const cached = cache.get(userId);
  if (cached && cached.expires > now) return cached.variant;

  try {
    const client = options.client !== undefined ? options.client : (getPostHogServer() as FlagClient | null);
    if (!client) return DEFAULT_OFFER_VARIANT;
    const variant = await evaluateFlag(client, userId);
    if (variant === null) return DEFAULT_OFFER_VARIANT;
    if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value as string);
    cache.set(userId, { variant, expires: now + CACHE_TTL_MS });
    return variant;
  } catch (error) {
    console.error('[offer-v2] flag evaluation failed:', error);
    return DEFAULT_OFFER_VARIANT;
  }
}
