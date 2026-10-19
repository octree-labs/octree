/**
 * The one rule for "does this account have Pro right now".
 *
 * `user_usage.is_pro` is a cache written by the Stripe webhook and the
 * subscription-status route, not the source of truth. A missed
 * `customer.subscription.deleted`, a customer deleted in the Stripe
 * dashboard, or a hand-edited row leaves `is_pro = true` behind for ever,
 * and until this helper existed both GET /api/subscription-status and
 * lib/subscription/features.ts OR-ed that flag into the answer. Now the flag
 * on its own grants nothing. Pro is:
 *
 *   1. the email allowlist (lib/paywall.ts), or
 *   2. `subscription_status = 'unlimited'`, the explicit manual grant
 *      (written by ensureUnlimitedStatus in the status route), or
 *   3. Stripe's effective status for the user's subscription is `active` or
 *      `trialing` (`paused` is not: PR #398), or
 *   4. when Stripe was not consulted: the row says `active`/`trialing`, it
 *      names a Stripe subscription, and `current_period_end` has not passed
 *      (a null period end is unknown, not ended: several live subscribers'
 *      rows predate the period columns, and the first status read after a
 *      Stripe answer fills them in). This is the window between Checkout
 *      and the first webhook, the cheap path for callers that do not talk
 *      to Stripe on every request, and the fallback while Stripe is down.
 *
 * Once Stripe HAS answered for the row's subscription (3), its answer wins
 * over the row (4): a `canceled` subscription with a row still saying
 * `active` is the stale case this file exists for.
 *
 * Pure and browser-safe: no Stripe client, no Supabase, so the client-side
 * `toFeatureUsage` applies the same rule to the status response the route
 * built with it.
 */

import { isProStatus } from '@/lib/stripe-subscription';

/** The user_usage columns the rule reads. */
export interface EntitlementRow {
  is_pro?: boolean | null;
  subscription_status?: string | null;
  stripe_subscription_id?: string | null;
  current_period_end?: string | null;
}

/**
 * What Stripe said about the row's subscription: an effective status
 * (lib/stripe-subscription.ts, so `paused` is possible), `missing` for a
 * 404, or null/undefined when Stripe was not asked.
 */
export type StripeStatusReport = string | 'missing' | null | undefined;

export interface EntitlementInput {
  row: EntitlementRow | null | undefined;
  stripeStatus?: StripeStatusReport;
  /** lib/paywall.ts `hasUnlimitedEdits(email)`. */
  hasUnlimited: boolean;
  now?: Date;
}

export type ProSource = 'allowlist' | 'unlimited' | 'stripe' | 'row';

export type ProDenial =
  | 'no_row'
  | 'stripe_not_active'
  | 'row_not_active'
  | 'no_subscription_id'
  | 'period_ended';

export type ProEntitlement =
  | { isPro: true; source: ProSource }
  | { isPro: false; reason: ProDenial };

/** True once `current_period_end` is a known date in the past; null is unknown. */
function periodEnded(value: string | null | undefined, now: Date): boolean {
  if (!value) return false;
  const ms = Date.parse(value);
  return Number.isFinite(ms) && ms <= now.getTime();
}

export function proEntitlement({
  row,
  stripeStatus,
  hasUnlimited,
  now = new Date(),
}: EntitlementInput): ProEntitlement {
  if (hasUnlimited) return { isPro: true, source: 'allowlist' };
  if (row?.subscription_status === 'unlimited') return { isPro: true, source: 'unlimited' };

  if (stripeStatus != null) {
    return isProStatus(stripeStatus)
      ? { isPro: true, source: 'stripe' }
      : { isPro: false, reason: 'stripe_not_active' };
  }

  if (!row) return { isPro: false, reason: 'no_row' };
  if (!isProStatus(row.subscription_status ?? '')) return { isPro: false, reason: 'row_not_active' };
  if (!row.stripe_subscription_id) return { isPro: false, reason: 'no_subscription_id' };
  if (periodEnded(row.current_period_end, now)) return { isPro: false, reason: 'period_ended' };
  return { isPro: true, source: 'row' };
}

/** `proEntitlement(...).isPro`. */
export function isProEntitled(input: EntitlementInput): boolean {
  return proEntitlement(input).isPro;
}

/**
 * Stripe answers that mean the subscription is gone for good. A row still
 * claiming Pro for one of these is stale and gets rewritten to the free
 * tier (status route self-heal, scripts/reconcile-pro-from-stripe.ts).
 * `past_due`/`unpaid`/`incomplete` are not in this set: those are the
 * webhook's to track, and they can still recover.
 */
export const REVOKING_STRIPE_STATUSES = ['canceled', 'incomplete_expired', 'missing'] as const;
export type RevokingStripeStatus = (typeof REVOKING_STRIPE_STATUSES)[number];

export function isRevokingStripeStatus(status: StripeStatusReport): status is RevokingStripeStatus {
  return (REVOKING_STRIPE_STATUSES as readonly string[]).includes(status ?? '');
}

/**
 * The `subscription_status` a revoke writes: Stripe's own status, as the
 * webhook would have written for the same subscription, and `canceled` for
 * a subscription Stripe no longer has. Neither is in `isProStatus`, so the
 * RPC derives `is_pro = false`.
 */
export function revokedRowStatus(status: RevokingStripeStatus): 'canceled' | 'incomplete_expired' {
  return status === 'missing' ? 'canceled' : status;
}

/**
 * True when the row itself claims Pro, i.e. it is worth asking Stripe
 * whether that claim still holds. Allowlisted and `unlimited` accounts are
 * excluded: their Pro does not depend on Stripe.
 */
export function rowClaimsPro(row: EntitlementRow | null | undefined, hasUnlimited: boolean): boolean {
  if (!row || hasUnlimited) return false;
  if (row.subscription_status === 'unlimited') return false;
  return Boolean(row.is_pro) || isProStatus(row.subscription_status ?? '');
}

/**
 * The fields GET /api/subscription-status puts in `usage` so the client can
 * run the same rule (`entitlementFromStatusResponse`) instead of trusting a
 * boolean it cannot audit.
 */
export interface EntitlementResponseFields {
  isPro: boolean;
  hasUnlimitedEdits: boolean;
  /** `user_usage.subscription_status`. */
  subscriptionStatus?: string | null;
  /** `user_usage.current_period_end` (ISO). */
  currentPeriodEnd?: string | null;
  /** Whether `user_usage.stripe_subscription_id` is set. */
  hasStripeSubscription?: boolean;
  /**
   * Stripe's effective status for the stored subscription when the route
   * asked about it (no live subscription was found but the row claimed
   * Pro); `missing` for a 404, null when Stripe was not asked or failed.
   */
  stripeStatus?: string | null;
}

export interface EntitlementResponseLike {
  /** True only when the route found an active/trialing Stripe subscription. */
  hasSubscription?: boolean;
  subscription?: { effective_status?: string } | null;
  usage: EntitlementResponseFields;
}

/**
 * The entitlement rule applied to the JSON of GET /api/subscription-status.
 * `subscription.effective_status` is Stripe's answer when the route found a
 * live subscription (`hasSubscription` alone, from an older response without
 * the field, means `active`), `usage.stripeStatus` its answer about the
 * stored subscription otherwise; without either the row fields decide,
 * exactly as on the server. A response from before the row fields existed
 * falls back to the `isPro` the server computed, which is now the same rule.
 */
export function entitlementFromStatusResponse(
  data: EntitlementResponseLike | null | undefined,
  now: Date = new Date()
): ProEntitlement {
  if (!data?.usage) return { isPro: false, reason: 'no_row' };
  const { usage } = data;
  const stripeStatus =
    data.subscription?.effective_status ??
    usage.stripeStatus ??
    (data.hasSubscription ? 'active' : null);
  const hasRowFields = 'subscriptionStatus' in usage;
  if (!hasRowFields && stripeStatus == null) {
    return usage.isPro
      ? { isPro: true, source: usage.hasUnlimitedEdits ? 'allowlist' : 'row' }
      : { isPro: false, reason: 'row_not_active' };
  }
  return proEntitlement({
    row: {
      subscription_status: usage.subscriptionStatus ?? null,
      current_period_end: usage.currentPeriodEnd ?? null,
      stripe_subscription_id: usage.hasStripeSubscription ? 'present' : null,
    },
    stripeStatus,
    hasUnlimited: Boolean(usage.hasUnlimitedEdits),
    now,
  });
}

/** What scripts/reconcile-pro-from-stripe.ts proposes for one `is_pro = true` row. */
export type ReconcileAction = 'revoke' | 'keep' | 'needs-owner';

export interface ReconcileDecision {
  action: ReconcileAction;
  reason: string;
}

/**
 * Classifies a row that currently says `is_pro = true`.
 *
 *   allowlisted email or `unlimited`     -> keep (deliberate grant)
 *   Stripe active/trialing               -> keep
 *   Stripe canceled/incomplete_expired   -> revoke
 *   Stripe 404 (`missing`)               -> revoke
 *   no subscription id                   -> needs-owner (never touched)
 *   any other Stripe status              -> needs-owner (paused, past_due,
 *                                           unpaid, incomplete: the webhook's
 *                                           business, and they can recover)
 */
export function reconcileDecision({
  row,
  stripeStatus,
  hasUnlimited,
}: {
  row: EntitlementRow;
  stripeStatus: StripeStatusReport;
  hasUnlimited: boolean;
}): ReconcileDecision {
  if (hasUnlimited) return { action: 'keep', reason: 'email allowlist' };
  if (row.subscription_status === 'unlimited') return { action: 'keep', reason: 'unlimited grant' };
  if (!row.stripe_subscription_id) {
    return { action: 'needs-owner', reason: `no subscription id, db status ${row.subscription_status ?? 'null'}` };
  }
  if (stripeStatus == null) return { action: 'needs-owner', reason: 'Stripe not consulted' };
  if (isProStatus(stripeStatus)) return { action: 'keep', reason: `Stripe ${stripeStatus}` };
  if (isRevokingStripeStatus(stripeStatus)) {
    return { action: 'revoke', reason: stripeStatus === 'missing' ? 'Stripe 404' : `Stripe ${stripeStatus}` };
  }
  return { action: 'needs-owner', reason: `Stripe ${stripeStatus}` };
}
