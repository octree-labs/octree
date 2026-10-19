/**
 * Pure gating decisions for the free tier. Every "does this user get to do X"
 * question in the client goes through `canUseFeature` so the rules live in one
 * place and can be unit tested without React or Supabase.
 *
 * The numeric limits themselves are enforced server-side
 * (app/api/octra-agent, app/api/track-edit); this only decides what the UI
 * does with the state those endpoints report.
 */

import { entitlementFromStatusResponse } from '@/lib/subscription/entitlement';

export type ProFeature = 'ai-edit' | 'export' | 'generate';

export interface FeatureUsage {
  /** Pro by the entitlement rule (lib/subscription/entitlement.ts). */
  isPro: boolean;
  /**
   * The subscription's last renewal charge failed (Stripe past_due /
   * unpaid): Pro is off until the card is updated; the dunning banner shows.
   */
  paymentPastDue?: boolean;
  /** Whitelisted account (lib/paywall.ts); bypasses every gate. */
  hasUnlimitedEdits?: boolean;
  /** Free-tier daily edit limit reached. */
  limitReached?: boolean;
  /** Pro monthly edit limit reached. */
  monthlyLimitReached?: boolean;
  /** Free generations left (every account starts with one). Pro: ignored. */
  freeGenerationsRemaining?: number;
  /** One-off generation credits bought through Checkout. Pro: ignored. */
  generationCredits?: number;
}

export type FeatureAccess =
  | { allowed: true }
  | {
      allowed: false;
      /**
       * `paywall`       - show the upgrade dialog (free user)
       * `monthly-limit` - Pro user out of edits this month; upgrading won't help
       * `unknown`       - plan not loaded yet; keep the control disabled
       */
      reason: 'paywall' | 'monthly-limit' | 'unknown';
    };

const PRO_ONLY_FEATURES: ReadonlySet<ProFeature> = new Set(['export']);

/**
 * Generations a non-Pro user can still start: the free one plus any bought
 * credits. The server decides for real (`consume_generation`); this only
 * drives the badge and whether submitting opens the paywall.
 */
export function remainingGenerations(usage: FeatureUsage): number {
  return Math.max(0, usage.freeGenerationsRemaining ?? 0) + Math.max(0, usage.generationCredits ?? 0);
}

export function canUseFeature(
  usage: FeatureUsage | null | undefined,
  feature: ProFeature
): FeatureAccess {
  if (!usage) {
    // Plain AI chat is enforced by the server (429), so don't block it while
    // the plan loads; Pro-only actions wait for the plan.
    return feature === 'ai-edit'
      ? { allowed: true }
      : { allowed: false, reason: 'unknown' };
  }

  if (usage.hasUnlimitedEdits) {
    return { allowed: true };
  }

  if (PRO_ONLY_FEATURES.has(feature)) {
    return usage.isPro ? { allowed: true } : { allowed: false, reason: 'paywall' };
  }

  if (feature === 'generate') {
    // Pro is unlimited; otherwise one free generation, then credits.
    return usage.isPro || remainingGenerations(usage) > 0
      ? { allowed: true }
      : { allowed: false, reason: 'paywall' };
  }

  // feature === 'ai-edit'
  if (usage.isPro) {
    return usage.monthlyLimitReached
      ? { allowed: false, reason: 'monthly-limit' }
      : { allowed: true };
  }

  return usage.limitReached
    ? { allowed: false, reason: 'paywall' }
    : { allowed: true };
}

/** Shape of the JSON returned by GET /api/subscription-status. */
export interface SubscriptionStatusResponse {
  hasSubscription: boolean;
  /**
   * `effective_status` is `paused` while collection is paused and the paid
   * period has ended: the subscription exists (Stripe says `active`) but
   * grants no Pro features.
   */
  subscription?: ({ effective_status?: string } & Record<string, unknown>) | null;
  usage: {
    /** Computed by the server with the entitlement rule; the client recomputes it from the fields below. */
    isPro: boolean;
    hasUnlimitedEdits: boolean;
    limitReached: boolean;
    monthlyLimitReached: boolean;
    /** Absent from older responses; treated as 0. */
    freeGenerationsRemaining?: number;
    generationCredits?: number;
    /** user_usage.subscription_status, current_period_end and whether a Stripe subscription id is stored. */
    subscriptionStatus?: string | null;
    currentPeriodEnd?: string | null;
    hasStripeSubscription?: boolean;
  } & Record<string, unknown>;
}

const NON_PRO_STATUSES: ReadonlySet<string> = new Set(['paused', 'past_due', 'unpaid']);
const PAST_DUE_STATUSES: ReadonlySet<string> = new Set(['past_due', 'unpaid']);

/**
 * A subscription that currently grants Pro: present and neither in a paused
 * window nor in dunning. Older responses without `effective_status` count
 * as granting.
 */
export function subscriptionGrantsPro(
  data: Pick<SubscriptionStatusResponse, 'hasSubscription' | 'subscription'> | null | undefined
): boolean {
  if (!data?.hasSubscription) return false;
  const status = data.subscription?.effective_status;
  return !status || !NON_PRO_STATUSES.has(status);
}

/** The subscription exists but its last payment failed (Stripe is retrying). */
export function subscriptionPastDue(
  data: Pick<SubscriptionStatusResponse, 'hasSubscription' | 'subscription'> | null | undefined
): boolean {
  const status = data?.subscription?.effective_status;
  return Boolean(data?.hasSubscription) && !!status && PAST_DUE_STATUSES.has(status);
}

export function toFeatureUsage(
  data: SubscriptionStatusResponse | null | undefined
): FeatureUsage | null {
  if (!data?.usage) return null;
  return {
    // One rule, shared with GET /api/subscription-status: a bare
    // `is_pro = true` on the row no longer grants Pro on its own.
    isPro: entitlementFromStatusResponse(data).isPro,
    paymentPastDue: subscriptionPastDue(data),
    hasUnlimitedEdits: Boolean(data.usage.hasUnlimitedEdits),
    limitReached: Boolean(data.usage.limitReached),
    monthlyLimitReached: Boolean(data.usage.monthlyLimitReached),
    freeGenerationsRemaining: Number(data.usage.freeGenerationsRemaining ?? 0) || 0,
    generationCredits: Number(data.usage.generationCredits ?? 0) || 0,
  };
}
