import { describe, it, expect } from 'vitest';
import {
  canUseFeature,
  remainingGenerations,
  subscriptionGrantsPro,
  toFeatureUsage,
  type FeatureUsage,
} from '@/lib/subscription/features';

const free: FeatureUsage = { isPro: false };
const freeAtLimit: FeatureUsage = { isPro: false, limitReached: true };
const pro: FeatureUsage = { isPro: true };
const proAtMonthlyLimit: FeatureUsage = { isPro: true, monthlyLimitReached: true };
const unlimited: FeatureUsage = { isPro: false, hasUnlimitedEdits: true, limitReached: true };

describe('canUseFeature', () => {
  describe('ai-edit', () => {
    it('allows a free user with edits left', () => {
      expect(canUseFeature(free, 'ai-edit')).toEqual({ allowed: true });
    });

    it('opens the paywall for a free user at the daily limit', () => {
      expect(canUseFeature(freeAtLimit, 'ai-edit')).toEqual({ allowed: false, reason: 'paywall' });
    });

    it('allows a Pro user with edits left', () => {
      expect(canUseFeature(pro, 'ai-edit')).toEqual({ allowed: true });
    });

    it('does not paywall a Pro user at the monthly limit (upgrading would not help)', () => {
      expect(canUseFeature(proAtMonthlyLimit, 'ai-edit')).toEqual({
        allowed: false,
        reason: 'monthly-limit',
      });
    });

    it('does not block chat while the plan is still loading (server enforces 429)', () => {
      expect(canUseFeature(null, 'ai-edit')).toEqual({ allowed: true });
      expect(canUseFeature(undefined, 'ai-edit')).toEqual({ allowed: true });
    });
  });

  describe.each(['export', 'generate'] as const)('%s (Pro, or a generation allowance)', (feature) => {
    it('opens the paywall for a free user with no allowance left, even with edits left', () => {
      expect(canUseFeature(free, feature)).toEqual({ allowed: false, reason: 'paywall' });
    });

    it('allows a Pro user', () => {
      expect(canUseFeature(pro, feature)).toEqual({ allowed: true });
    });

    it('still allows a Pro user who is out of monthly edits', () => {
      expect(canUseFeature(proAtMonthlyLimit, feature)).toEqual({ allowed: true });
    });

    it('waits for the plan to load rather than allowing by default', () => {
      expect(canUseFeature(null, feature)).toEqual({ allowed: false, reason: 'unknown' });
    });
  });

  describe('generate allowance (one free, then credits)', () => {
    const freeWithFreeGen: FeatureUsage = { isPro: false, freeGenerationsRemaining: 1 };
    const freeWithCredit: FeatureUsage = { isPro: false, freeGenerationsRemaining: 0, generationCredits: 2 };
    const freeSpent: FeatureUsage = { isPro: false, freeGenerationsRemaining: 0, generationCredits: 0 };

    it('lets a new free user use the free generation', () => {
      expect(canUseFeature(freeWithFreeGen, 'generate')).toEqual({ allowed: true });
      expect(remainingGenerations(freeWithFreeGen)).toBe(1);
    });

    it('lets a free user with bought credits generate', () => {
      expect(canUseFeature(freeWithCredit, 'generate')).toEqual({ allowed: true });
      expect(remainingGenerations(freeWithCredit)).toBe(2);
    });

    it('paywalls a free user whose free generation and credits are spent', () => {
      expect(canUseFeature(freeSpent, 'generate')).toEqual({ allowed: false, reason: 'paywall' });
      expect(remainingGenerations(freeSpent)).toBe(0);
    });

    it('does not let the allowance unlock export', () => {
      expect(canUseFeature(freeWithCredit, 'export')).toEqual({ allowed: false, reason: 'paywall' });
    });

    it('ignores negative counts from a bad response', () => {
      expect(remainingGenerations({ isPro: false, freeGenerationsRemaining: -1, generationCredits: -3 })).toBe(0);
    });
  });

  it('whitelisted (unlimited) accounts bypass every gate', () => {
    expect(canUseFeature(unlimited, 'ai-edit')).toEqual({ allowed: true });
    expect(canUseFeature(unlimited, 'export')).toEqual({ allowed: true });
    expect(canUseFeature(unlimited, 'generate')).toEqual({ allowed: true });
  });

  describe('export with a one-off project unlock', () => {
    it('allows an unlocked project on the free plan', () => {
      expect(canUseFeature(free, 'export', { projectUnlocked: true })).toEqual({ allowed: true });
      expect(canUseFeature(freeAtLimit, 'export', { projectUnlocked: true })).toEqual({ allowed: true });
    });

    it('allows an unlocked project before the plan has loaded', () => {
      expect(canUseFeature(null, 'export', { projectUnlocked: true })).toEqual({ allowed: true });
    });

    it('leaves a locked project exactly as before', () => {
      for (const usage of [free, freeAtLimit, pro, proAtMonthlyLimit, unlimited, null]) {
        expect(canUseFeature(usage, 'export', { projectUnlocked: false })).toEqual(canUseFeature(usage, 'export'));
        expect(canUseFeature(usage, 'export', {})).toEqual(canUseFeature(usage, 'export'));
      }
      expect(canUseFeature(free, 'export', { projectUnlocked: false })).toEqual({ allowed: false, reason: 'paywall' });
    });

    it('unlocks export only, never AI edits or Generate', () => {
      expect(canUseFeature(freeAtLimit, 'ai-edit', { projectUnlocked: true })).toEqual({ allowed: false, reason: 'paywall' });
      expect(canUseFeature(free, 'generate', { projectUnlocked: true })).toEqual({ allowed: false, reason: 'paywall' });
    });
  });
});

describe('toFeatureUsage', () => {
  const usage = {
    editCount: 5,
    isPro: false,
    hasUnlimitedEdits: false,
    limitReached: true,
    monthlyLimitReached: false,
  };

  it('returns null until the status has loaded', () => {
    expect(toFeatureUsage(null)).toBeNull();
    expect(toFeatureUsage(undefined)).toBeNull();
  });

  it('treats an active Stripe subscription as Pro even if is_pro lags behind', () => {
    expect(toFeatureUsage({ hasSubscription: true, usage })).toMatchObject({ isPro: true });
    expect(
      toFeatureUsage({ hasSubscription: true, subscription: { effective_status: 'active' }, usage })
    ).toMatchObject({ isPro: true });
  });

  it('does not treat a paused subscription as Pro: the server gates on is_pro = false meanwhile', () => {
    expect(
      toFeatureUsage({ hasSubscription: true, subscription: { effective_status: 'paused' }, usage })
    ).toMatchObject({ isPro: false });
    expect(
      subscriptionGrantsPro({ hasSubscription: true, subscription: { effective_status: 'paused' } })
    ).toBe(false);
    expect(subscriptionGrantsPro({ hasSubscription: false, subscription: null })).toBe(false);
  });

  it('a past_due subscription grants no Pro and flags the payment problem', () => {
    const data = { hasSubscription: true, subscription: { effective_status: 'past_due' }, usage };
    expect(subscriptionGrantsPro(data)).toBe(false);
    expect(toFeatureUsage(data)).toMatchObject({ isPro: false, paymentPastDue: true });
    expect(
      toFeatureUsage({ hasSubscription: true, subscription: { effective_status: 'active' }, usage })
    ).toMatchObject({ isPro: true, paymentPastDue: false });
  });

  it('maps a free user at the daily limit (allowance fields default to 0)', () => {
    expect(toFeatureUsage({ hasSubscription: false, usage })).toEqual({
      isPro: false,
      paymentPastDue: false,
      hasUnlimitedEdits: false,
      limitReached: true,
      monthlyLimitReached: false,
      freeGenerationsRemaining: 0,
      generationCredits: 0,
      editCount: 5,
      monthlyEditCount: 0,
      firstPurchaseOffer: null,
    });
  });

  it('carries a known first-purchase offer and drops anything else', () => {
    expect(toFeatureUsage({ hasSubscription: false, usage, first_purchase_offer: 'welcome50' })).toMatchObject({
      firstPurchaseOffer: 'welcome50',
    });
    expect(
      toFeatureUsage({ hasSubscription: false, usage, first_purchase_offer: 'bogus' as any })
    ).toMatchObject({ firstPurchaseOffer: null });
  });

  it('carries the generate allowance through', () => {
    expect(
      toFeatureUsage({
        hasSubscription: false,
        usage: { ...usage, freeGenerationsRemaining: 1, generationCredits: 3 },
      })
    ).toMatchObject({ freeGenerationsRemaining: 1, generationCredits: 3 });
  });
});
