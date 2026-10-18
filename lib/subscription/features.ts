/**
 * Pure gating decisions for the free tier. Every "does this user get to do X"
 * question in the client goes through `canUseFeature` so the rules live in one
 * place and can be unit tested without React or Supabase.
 *
 * The numeric limits themselves are enforced server-side
 * (app/api/octra-agent, app/api/track-edit); this only decides what the UI
 * does with the state those endpoints report.
 */

export type ProFeature = 'ai-edit' | 'export' | 'generate';

export interface FeatureUsage {
  /** Active subscription, or `is_pro` on user_usage. */
  isPro: boolean;
  /** Whitelisted account (lib/paywall.ts); bypasses every gate. */
  hasUnlimitedEdits?: boolean;
  /** Free-tier daily edit limit reached. */
  limitReached?: boolean;
  /** Pro monthly edit limit reached. */
  monthlyLimitReached?: boolean;
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

const PRO_ONLY_FEATURES: ReadonlySet<ProFeature> = new Set(['export', 'generate']);

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
  usage: {
    isPro: boolean;
    hasUnlimitedEdits: boolean;
    limitReached: boolean;
    monthlyLimitReached: boolean;
  } & Record<string, unknown>;
}

export function toFeatureUsage(
  data: SubscriptionStatusResponse | null | undefined
): FeatureUsage | null {
  if (!data?.usage) return null;
  return {
    isPro: Boolean(data.hasSubscription || data.usage.isPro),
    hasUnlimitedEdits: Boolean(data.usage.hasUnlimitedEdits),
    limitReached: Boolean(data.usage.limitReached),
    monthlyLimitReached: Boolean(data.usage.monthlyLimitReached),
  };
}
