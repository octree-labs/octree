import { describe, it, expect } from 'vitest';

import {
  decideExport,
  freeExportStateFor,
  toFeatureUsage,
  type FeatureUsage,
  type SubscriptionStatusResponse,
} from '@/lib/subscription/features';
import { freeExportClaimStatus, readFreeFirstExportUsed } from '@/lib/export-unlock';
import { FREE_FIRST_EXPORT_ENABLED } from '@/data/constants';

/**
 * The free first export: the first export of every account is free, from
 * the second on the paywall applies (Pro, or the $4.99 single unlock).
 */

const freeUnused: FeatureUsage = { isPro: false, freeExport: 'available' };
const freeUsed: FeatureUsage = { isPro: false, freeExport: 'used' };
const pro: FeatureUsage = { isPro: true, freeExport: 'unavailable' };
const unlimited: FeatureUsage = { isPro: false, hasUnlimitedEdits: true, freeExport: 'unavailable' };

describe('decideExport', () => {
  it('is on by default', () => {
    expect(FREE_FIRST_EXPORT_ENABLED).toBe(true);
  });

  it('first export of a free user: claim the free one, no paywall', () => {
    expect(decideExport(freeUnused, { freeFirstEnabled: true })).toEqual({ action: 'claim-free' });
  });

  it('second export (free one used, another project): paywall with reason free_export_used', () => {
    expect(decideExport(freeUsed, { freeFirstEnabled: true })).toEqual({
      action: 'paywall',
      reason: 'free_export_used',
    });
  });

  it('the project the free export was used on stays exportable', () => {
    expect(decideExport(freeUsed, { projectUnlocked: true, freeFirstEnabled: true })).toEqual({ action: 'export' });
  });

  it('Pro and allowlisted users export directly and never spend the free export', () => {
    expect(decideExport(pro, { freeFirstEnabled: true })).toEqual({ action: 'export' });
    expect(decideExport(unlimited, { freeFirstEnabled: true })).toEqual({ action: 'export' });
    // Even if a stale response says available.
    expect(decideExport({ isPro: true, freeExport: 'available' }, { freeFirstEnabled: true })).toEqual({
      action: 'export',
    });
  });

  it('a bought single-project unlock exports, whatever the plan state', () => {
    expect(decideExport(null, { projectUnlocked: true, freeFirstEnabled: true })).toEqual({ action: 'export' });
  });

  it('waits while the plan is loading', () => {
    expect(decideExport(null, { freeFirstEnabled: true })).toEqual({ action: 'unknown' });
  });

  it('kill switch off: the plain pro_feature paywall, used or not', () => {
    expect(decideExport(freeUnused, { freeFirstEnabled: false })).toEqual({ action: 'paywall', reason: 'pro_feature' });
    expect(decideExport(freeUsed, { freeFirstEnabled: false })).toEqual({ action: 'paywall', reason: 'pro_feature' });
    expect(decideExport(pro, { freeFirstEnabled: false })).toEqual({ action: 'export' });
  });

  it('an older response without freeExport keeps the pro_feature paywall', () => {
    expect(decideExport({ isPro: false }, { freeFirstEnabled: true })).toEqual({
      action: 'paywall',
      reason: 'pro_feature',
    });
    expect(decideExport({ isPro: false, freeExport: 'unavailable' }, { freeFirstEnabled: true })).toEqual({
      action: 'paywall',
      reason: 'pro_feature',
    });
  });
});

describe('freeExportStateFor', () => {
  it('available for a free user with no free_first row, used once there is one', () => {
    expect(freeExportStateFor({ enabled: true, entitled: false, usedFree: false })).toBe('available');
    expect(freeExportStateFor({ enabled: true, entitled: false, usedFree: true })).toBe('used');
  });

  it('unavailable for entitled users, with the switch off, or when the row cannot be read', () => {
    expect(freeExportStateFor({ enabled: true, entitled: true, usedFree: false })).toBe('unavailable');
    expect(freeExportStateFor({ enabled: false, entitled: false, usedFree: false })).toBe('unavailable');
    expect(freeExportStateFor({ enabled: true, entitled: false, usedFree: null })).toBe('unavailable');
  });
});

describe('toFeatureUsage freeExport', () => {
  const response = (freeExport?: unknown): SubscriptionStatusResponse =>
    ({
      hasSubscription: false,
      subscription: null,
      usage: { isPro: false, hasUnlimitedEdits: false, limitReached: false, monthlyLimitReached: false, freeExport },
    }) as SubscriptionStatusResponse;

  it('passes a known state through', () => {
    expect(toFeatureUsage(response('available'))?.freeExport).toBe('available');
    expect(toFeatureUsage(response('used'))?.freeExport).toBe('used');
  });

  it('reads an absent or unknown value as unavailable', () => {
    expect(toFeatureUsage(response())?.freeExport).toBe('unavailable');
    expect(toFeatureUsage(response('bogus'))?.freeExport).toBe('unavailable');
  });
});

describe('freeExportClaimStatus', () => {
  it('maps the RPC answers', () => {
    expect(freeExportClaimStatus('granted')).toBe('granted');
    expect(freeExportClaimStatus('already_unlocked')).toBe('unlocked');
    expect(freeExportClaimStatus('used')).toBe('used');
    expect(freeExportClaimStatus('not_found')).toBe('unavailable');
    expect(freeExportClaimStatus(null)).toBe('unavailable');
  });
});

describe('readFreeFirstExportUsed', () => {
  function client(result: { data: unknown; error: unknown }) {
    const eqs: unknown[][] = [];
    const chain = {
      eq: (...args: unknown[]) => {
        eqs.push(args);
        return chain;
      },
      limit: async () => result,
    };
    return { eqs, supabase: { from: () => ({ select: () => chain }) } as any };
  }

  it('looks for a free_first row of the user', async () => {
    const { eqs, supabase } = client({ data: [{ id: 'u1' }], error: null });
    expect(await readFreeFirstExportUsed(supabase, 'user-1')).toBe(true);
    expect(eqs).toEqual([
      ['user_id', 'user-1'],
      ['source', 'free_first'],
    ]);
  });

  it('false with no row', async () => {
    const { supabase } = client({ data: [], error: null });
    expect(await readFreeFirstExportUsed(supabase, 'user-1')).toBe(false);
  });

  it('null when the migration is not applied (no source column), so nothing is offered', async () => {
    const { supabase } = client({ data: null, error: { code: '42703' } });
    expect(await readFreeFirstExportUsed(supabase, 'user-1')).toBeNull();
  });
});
