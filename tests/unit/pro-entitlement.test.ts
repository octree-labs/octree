import { describe, it, expect } from 'vitest';
import {
  entitlementFromStatusResponse,
  isRevokingStripeStatus,
  proEntitlement,
  reconcileDecision,
  revokedRowStatus,
  rowClaimsPro,
  type EntitlementRow,
} from '@/lib/subscription/entitlement';

/**
 * The one rule for Pro (lib/subscription/entitlement.ts). Before it, a bare
 * `is_pro = true` on user_usage granted Pro for ever: 9 production rows
 * still said Pro for subscriptions Stripe had canceled months earlier.
 */

const now = new Date('2026-10-18T12:00:00Z');
const future = '2026-11-18T00:00:00+00:00';
const past = '2026-03-01T00:00:00+00:00';

function row(overrides: Partial<EntitlementRow> = {}): EntitlementRow {
  return {
    is_pro: true,
    subscription_status: 'active',
    stripe_subscription_id: 'sub_123456',
    current_period_end: future,
    ...overrides,
  };
}

describe('proEntitlement', () => {
  it('grants Pro for an active Stripe subscription', () => {
    expect(proEntitlement({ row: row(), stripeStatus: 'active', hasUnlimited: false, now })).toEqual({
      isPro: true,
      source: 'stripe',
    });
    expect(proEntitlement({ row: row(), stripeStatus: 'trialing', hasUnlimited: false, now }).isPro).toBe(true);
  });

  it('denies a stale is_pro = true once Stripe reports the subscription canceled', () => {
    expect(
      proEntitlement({ row: row({ is_pro: true, subscription_status: 'active' }), stripeStatus: 'canceled', hasUnlimited: false, now })
    ).toEqual({ isPro: false, reason: 'stripe_not_active' });
    expect(proEntitlement({ row: row(), stripeStatus: 'incomplete_expired', hasUnlimited: false, now }).isPro).toBe(false);
    expect(proEntitlement({ row: row(), stripeStatus: 'missing', hasUnlimited: false, now }).isPro).toBe(false);
  });

  it('keeps paused as not Pro, whatever the row says', () => {
    expect(proEntitlement({ row: row(), stripeStatus: 'paused', hasUnlimited: false, now }).isPro).toBe(false);
    expect(
      proEntitlement({ row: row({ subscription_status: 'paused' }), stripeStatus: null, hasUnlimited: false, now })
    ).toEqual({ isPro: false, reason: 'row_not_active' });
  });

  it('grants Pro for the explicit unlimited grant, even when Stripe says canceled', () => {
    expect(
      proEntitlement({ row: row({ subscription_status: 'unlimited' }), stripeStatus: 'canceled', hasUnlimited: false, now })
    ).toEqual({ isPro: true, source: 'unlimited' });
    expect(
      proEntitlement({ row: row({ subscription_status: 'unlimited', stripe_subscription_id: null, current_period_end: null }), hasUnlimited: false, now }).isPro
    ).toBe(true);
  });

  it('grants Pro for the email allowlist regardless of the row', () => {
    expect(proEntitlement({ row: null, hasUnlimited: true, now })).toEqual({ isPro: true, source: 'allowlist' });
    expect(proEntitlement({ row: row({ is_pro: false, subscription_status: 'inactive' }), stripeStatus: 'canceled', hasUnlimited: true, now }).isPro).toBe(true);
  });

  it('grants Pro from the row alone while the period is ahead and a subscription id exists (pre-webhook window)', () => {
    expect(proEntitlement({ row: row(), hasUnlimited: false, now })).toEqual({ isPro: true, source: 'row' });
    expect(proEntitlement({ row: row({ subscription_status: 'trialing', is_pro: false }), hasUnlimited: false, now }).isPro).toBe(true);
  });

  it('denies a row whose period has ended, even with is_pro = true', () => {
    expect(proEntitlement({ row: row({ current_period_end: past }), hasUnlimited: false, now })).toEqual({
      isPro: false,
      reason: 'period_ended',
    });
    expect(proEntitlement({ row: row({ current_period_end: 'not a date' }), hasUnlimited: false, now }).isPro).toBe(true);
  });

  it('treats a missing period end as unknown, not ended (live rows that predate the period columns)', () => {
    expect(proEntitlement({ row: row({ current_period_end: null }), hasUnlimited: false, now })).toEqual({
      isPro: true,
      source: 'row',
    });
    // Stripe's answer still wins over the row.
    expect(
      proEntitlement({ row: row({ current_period_end: null }), stripeStatus: 'canceled', hasUnlimited: false, now }).isPro
    ).toBe(false);
    // ...and a row without a subscription id or an active status still gets nothing.
    expect(
      proEntitlement({ row: row({ current_period_end: null, stripe_subscription_id: null }), hasUnlimited: false, now }).isPro
    ).toBe(false);
    expect(
      proEntitlement({ row: row({ current_period_end: null, subscription_status: 'canceled' }), hasUnlimited: false, now }).isPro
    ).toBe(false);
  });

  it('denies a row with no subscription id, even with is_pro = true and an active status', () => {
    expect(proEntitlement({ row: row({ stripe_subscription_id: null }), hasUnlimited: false, now })).toEqual({
      isPro: false,
      reason: 'no_subscription_id',
    });
  });

  it('denies is_pro = true with a non-Pro status (inactive, canceled, pro)', () => {
    for (const status of ['inactive', 'canceled', 'pro', null]) {
      expect(proEntitlement({ row: row({ subscription_status: status }), hasUnlimited: false, now })).toEqual({
        isPro: false,
        reason: 'row_not_active',
      });
    }
  });

  it('denies when there is no row', () => {
    expect(proEntitlement({ row: null, hasUnlimited: false, now })).toEqual({ isPro: false, reason: 'no_row' });
  });
});

describe('rowClaimsPro', () => {
  it('is true for is_pro or an active status, false for grants that do not depend on Stripe', () => {
    expect(rowClaimsPro(row(), false)).toBe(true);
    expect(rowClaimsPro(row({ is_pro: false, subscription_status: 'trialing' }), false)).toBe(true);
    expect(rowClaimsPro(row({ is_pro: true, subscription_status: 'canceled' }), false)).toBe(true);
    expect(rowClaimsPro(row({ is_pro: false, subscription_status: 'inactive' }), false)).toBe(false);
    expect(rowClaimsPro(row({ subscription_status: 'unlimited' }), false)).toBe(false);
    expect(rowClaimsPro(row(), true)).toBe(false);
    expect(rowClaimsPro(null, false)).toBe(false);
  });
});

describe('isRevokingStripeStatus', () => {
  it('covers canceled, incomplete_expired and a 404', () => {
    expect(isRevokingStripeStatus('canceled')).toBe(true);
    expect(isRevokingStripeStatus('incomplete_expired')).toBe(true);
    expect(isRevokingStripeStatus('missing')).toBe(true);
    for (const status of ['active', 'trialing', 'paused', 'past_due', 'unpaid', 'incomplete', null, undefined]) {
      expect(isRevokingStripeStatus(status)).toBe(false);
    }
  });
});

describe('revokedRowStatus', () => {
  it('writes what the webhook would have written: Stripe’s status, canceled for a 404', () => {
    expect(revokedRowStatus('canceled')).toBe('canceled');
    expect(revokedRowStatus('incomplete_expired')).toBe('incomplete_expired');
    expect(revokedRowStatus('missing')).toBe('canceled');
    // Neither grants Pro on the next read.
    for (const status of ['canceled', 'incomplete_expired']) {
      expect(proEntitlement({ row: row({ is_pro: false, subscription_status: status }), hasUnlimited: false, now }).isPro).toBe(false);
      expect(rowClaimsPro(row({ is_pro: false, subscription_status: status }), false)).toBe(false);
    }
  });
});

describe('entitlementFromStatusResponse (client side, same rule)', () => {
  const usage = {
    isPro: true,
    hasUnlimitedEdits: false,
    subscriptionStatus: 'active',
    currentPeriodEnd: future,
    hasStripeSubscription: true,
  };

  it('uses effective_status as Stripe’s answer', () => {
    expect(
      entitlementFromStatusResponse({ hasSubscription: true, subscription: { effective_status: 'active' }, usage }, now)
    ).toEqual({ isPro: true, source: 'stripe' });
    expect(
      entitlementFromStatusResponse({ hasSubscription: true, subscription: { effective_status: 'paused' }, usage }, now).isPro
    ).toBe(false);
  });

  it('treats hasSubscription without effective_status (older response) as active', () => {
    expect(entitlementFromStatusResponse({ hasSubscription: true, usage: { ...usage, isPro: false } }, now).isPro).toBe(true);
  });

  it('uses the server’s answer about the stored subscription when no live one was found', () => {
    // Stored subscription still active (the customer the route resolved does not own it).
    expect(
      entitlementFromStatusResponse(
        { hasSubscription: false, subscription: null, usage: { ...usage, currentPeriodEnd: past, stripeStatus: 'active' } },
        now
      )
    ).toEqual({ isPro: true, source: 'stripe' });
    // Stored subscription canceled: the row's future period end does not help.
    expect(
      entitlementFromStatusResponse(
        { hasSubscription: false, subscription: null, usage: { ...usage, stripeStatus: 'canceled' } },
        now
      )
    ).toEqual({ isPro: false, reason: 'stripe_not_active' });
    // Not asked / failed: the row rule.
    expect(
      entitlementFromStatusResponse(
        { hasSubscription: false, subscription: null, usage: { ...usage, stripeStatus: null } },
        now
      )
    ).toEqual({ isPro: true, source: 'row' });
  });

  it('applies the row rule when no live subscription was found', () => {
    expect(entitlementFromStatusResponse({ hasSubscription: false, subscription: null, usage }, now)).toEqual({
      isPro: true,
      source: 'row',
    });
    expect(
      entitlementFromStatusResponse(
        { hasSubscription: false, subscription: null, usage: { ...usage, currentPeriodEnd: past } },
        now
      ).isPro
    ).toBe(false);
    expect(
      entitlementFromStatusResponse(
        { hasSubscription: false, subscription: null, usage: { ...usage, hasStripeSubscription: false } },
        now
      ).isPro
    ).toBe(false);
    expect(
      entitlementFromStatusResponse(
        { hasSubscription: false, subscription: null, usage: { ...usage, subscriptionStatus: 'unlimited', hasStripeSubscription: false } },
        now
      )
    ).toEqual({ isPro: true, source: 'unlimited' });
    expect(
      entitlementFromStatusResponse(
        { hasSubscription: false, subscription: null, usage: { ...usage, subscriptionStatus: 'inactive', hasUnlimitedEdits: true } },
        now
      )
    ).toEqual({ isPro: true, source: 'allowlist' });
  });

  it('falls back to the server’s isPro for a response without the row fields', () => {
    expect(
      entitlementFromStatusResponse({ hasSubscription: false, usage: { isPro: true, hasUnlimitedEdits: false } }, now).isPro
    ).toBe(true);
    expect(
      entitlementFromStatusResponse({ hasSubscription: false, usage: { isPro: false, hasUnlimitedEdits: false } }, now).isPro
    ).toBe(false);
    expect(entitlementFromStatusResponse(null, now).isPro).toBe(false);
  });
});

describe('reconcileDecision (scripts/reconcile-pro-from-stripe.ts)', () => {
  it('keeps deliberate grants before looking at Stripe', () => {
    expect(reconcileDecision({ row: row(), stripeStatus: 'canceled', hasUnlimited: true }).action).toBe('keep');
    expect(
      reconcileDecision({ row: row({ subscription_status: 'unlimited' }), stripeStatus: 'canceled', hasUnlimited: false }).action
    ).toBe('keep');
    expect(
      reconcileDecision({ row: row({ subscription_status: 'unlimited', stripe_subscription_id: null }), stripeStatus: null, hasUnlimited: false }).action
    ).toBe('keep');
  });

  it('keeps live subscriptions and revokes gone ones', () => {
    expect(reconcileDecision({ row: row(), stripeStatus: 'active', hasUnlimited: false }).action).toBe('keep');
    expect(reconcileDecision({ row: row(), stripeStatus: 'trialing', hasUnlimited: false }).action).toBe('keep');
    expect(reconcileDecision({ row: row(), stripeStatus: 'canceled', hasUnlimited: false }).action).toBe('revoke');
    expect(reconcileDecision({ row: row(), stripeStatus: 'incomplete_expired', hasUnlimited: false }).action).toBe('revoke');
    expect(reconcileDecision({ row: row(), stripeStatus: 'missing', hasUnlimited: false })).toEqual({
      action: 'revoke',
      reason: 'Stripe 404',
    });
  });

  it('leaves rows without a subscription id to the owner', () => {
    for (const status of ['active', 'trialing', 'pro', 'inactive']) {
      expect(
        reconcileDecision({ row: row({ stripe_subscription_id: null, subscription_status: status }), stripeStatus: null, hasUnlimited: false }).action
      ).toBe('needs-owner');
    }
  });

  it('leaves statuses the webhook owns to the owner', () => {
    for (const status of ['paused', 'past_due', 'unpaid', 'incomplete']) {
      expect(reconcileDecision({ row: row(), stripeStatus: status, hasUnlimited: false }).action).toBe('needs-owner');
    }
    expect(reconcileDecision({ row: row(), stripeStatus: null, hasUnlimited: false }).action).toBe('needs-owner');
  });
});
