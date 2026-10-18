import { describe, it, expect } from 'vitest';
import {
  canUseFeature,
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

  describe.each(['export', 'generate'] as const)('%s (Pro only)', (feature) => {
    it('opens the paywall for a free user, even with edits left', () => {
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

  it('whitelisted (unlimited) accounts bypass every gate', () => {
    expect(canUseFeature(unlimited, 'ai-edit')).toEqual({ allowed: true });
    expect(canUseFeature(unlimited, 'export')).toEqual({ allowed: true });
    expect(canUseFeature(unlimited, 'generate')).toEqual({ allowed: true });
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
  });

  it('maps a free user at the daily limit', () => {
    expect(toFeatureUsage({ hasSubscription: false, usage })).toEqual({
      isPro: false,
      hasUnlimitedEdits: false,
      limitReached: true,
      monthlyLimitReached: false,
    });
  });
});
