import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import { OFFER_V2_SINCE } from '@/data/constants';
import { captureServerEventAfterResponse, getPostHogServer } from '@/lib/posthog-server';
import { AnalyticsEvents } from '@/lib/analytics/events';
import {
  DEFAULT_OFFER_VARIANT,
  OFFER_V2_FLAG_KEY,
  inOfferExperiment,
  isOfferVariant,
  offerVariantFromFlag,
  offerVariantOverride,
  type OfferVariant,
} from '@/lib/offer-v2/variant';

/**
 * Assignment of the `onboarding-offer-v2` experiment: once per user, server
 * side, stored in user_usage.offer_variant (service role; the API roles
 * cannot write it). Only GET /api/offer assigns, and it is only called where
 * the offer is shown (the onboarding plan step, the paywall dialog when it
 * opens), so PostHog's exposure is the people who saw a paywall. Checkout,
 * /success and the webhook read the stored value (lib/offer-v2/variant.ts
 * `effectiveOfferVariant`) and never evaluate the flag.
 *
 * Order: the `NEXT_PUBLIC_OFFER_V2` override (never stored, so removing it
 * rolls back); the stored assignment; `control` for accounts created before
 * OFFER_V2_SINCE (PostHog not asked, nothing stored); PostHog's answer,
 * stored. No PostHog, an error or a timeout answers `control` for this
 * request without storing anything, so the next request asks again.
 */

const FLAG_TIMEOUT_MS = 1500;

type FlagClient = {
  getFeatureFlag(key: string, distinctId: string, options?: Record<string, unknown>): Promise<unknown>;
};

/** PostHog's answer, or null for no client, an error or a timeout (never stored). */
export async function evaluateOfferFlag(userId: string, client: FlagClient | null): Promise<OfferVariant | null> {
  if (!client) return null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), FLAG_TIMEOUT_MS);
  });
  try {
    const value = await Promise.race([
      client.getFeatureFlag(OFFER_V2_FLAG_KEY, userId).then(
        (answer) => ({ answer }),
        (error: unknown) => {
          console.error('[offer-v2] flag evaluation failed:', error);
          return null;
        }
      ),
      timeout,
    ]);
    return value === null ? null : offerVariantFromFlag(value.answer);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export interface OfferAssignmentInput {
  userId: string;
  /** auth.users.created_at. */
  createdAt: string | null | undefined;
  /** user_usage.offer_variant as read now. */
  persisted: unknown;
  env?: Record<string, string | undefined>;
  client?: FlagClient | null;
  since?: string;
}

export interface OfferAssignment {
  variant: OfferVariant;
  /** Store it (a fresh PostHog answer); false for anything else. */
  persist: boolean;
}

/** Pure order of the rules above; `client` is only asked when nothing else decides. */
export async function decideOfferVariant(input: OfferAssignmentInput): Promise<OfferAssignment> {
  const env = input.env ?? process.env;
  const forced = offerVariantOverride(env.NEXT_PUBLIC_OFFER_V2);
  if (forced) return { variant: forced, persist: false };
  if (isOfferVariant(input.persisted)) return { variant: input.persisted, persist: false };
  if (!inOfferExperiment(input.createdAt, input.since ?? OFFER_V2_SINCE)) {
    return { variant: DEFAULT_OFFER_VARIANT, persist: false };
  }
  const client = input.client !== undefined ? input.client : (getPostHogServer() as FlagClient | null);
  const answer = await evaluateOfferFlag(input.userId, client);
  return answer ? { variant: answer, persist: true } : { variant: DEFAULT_OFFER_VARIANT, persist: false };
}

/**
 * The user's variant, assigning and storing it on the first call. `admin`
 * is the service-role client. Never throws: any failure is `control` for
 * this request.
 */
export async function assignOfferVariant(
  admin: SupabaseClient<any, any, any>,
  user: { id: string; created_at?: string | null },
  options: { env?: Record<string, string | undefined>; client?: FlagClient | null } = {}
): Promise<OfferVariant> {
  try {
    const { data: row } = await admin.from('user_usage').select('offer_variant').eq('user_id', user.id).maybeSingle();
    const decision = await decideOfferVariant({
      userId: user.id,
      createdAt: user.created_at,
      persisted: (row as { offer_variant?: unknown } | null)?.offer_variant,
      ...options,
    });
    if (!decision.persist) return decision.variant;

    // First writer wins: a concurrent request that stored first decides.
    const { data: written, error } = await admin
      .from('user_usage')
      .update({ offer_variant: decision.variant })
      .eq('user_id', user.id)
      .is('offer_variant', null)
      .select('offer_variant');
    if (error) throw error;
    if (Array.isArray(written) && written.length > 0) {
      captureServerEventAfterResponse(user.id, AnalyticsEvents.OFFER_VARIANT_ASSIGNED, {
        offer_variant: decision.variant,
        $set: { offer_variant: decision.variant },
      });
      return decision.variant;
    }
    const { data: stored } = await admin.from('user_usage').select('offer_variant').eq('user_id', user.id).maybeSingle();
    const storedVariant = (stored as { offer_variant?: unknown } | null)?.offer_variant;
    return isOfferVariant(storedVariant) ? storedVariant : decision.variant;
  } catch (error) {
    console.error('[offer-v2] assignment failed; control for this request:', error);
    return DEFAULT_OFFER_VARIANT;
  }
}
