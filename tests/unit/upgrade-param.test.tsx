import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';

import { UpgradeParam } from '@/components/lifecycle/upgrade-param';
import { PaywallActions, usePaywallStore } from '@/stores/paywall';
import { track } from '@/lib/analytics/track';

const nav = vi.hoisted(() => ({ replace: vi.fn(), search: 'upgrade=1' }));

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(nav.search),
  usePathname: () => '/',
  useRouter: () => ({ replace: nav.replace }),
}));
vi.mock('@/lib/analytics/track', () => ({ track: vi.fn() }));
vi.mock('@/lib/requests/paywall', () => ({ recordPaywallHit: vi.fn(async () => {}) }));

function statusResponse(firstPurchaseOffer: string | null) {
  return {
    ok: true,
    json: async () => ({
      hasSubscription: false,
      usage: { isPro: false, hasUnlimitedEdits: false, limitReached: false, monthlyLimitReached: false },
      first_purchase_offer: firstPurchaseOffer,
    }),
  };
}

/** A fetch that resolves only when `release` is called. */
function deferredFetch(response: unknown) {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  global.fetch = vi.fn(async () => {
    await gate;
    return response;
  }) as any;
  return () => act(async () => release());
}

describe('?upgrade=1 waits for the subscription status', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    nav.search = 'upgrade=1';
    PaywallActions.close();
    usePaywallStore.setState({ open: false, feature: null, reason: null, offers: ['pro'], firstPurchaseOffer: null });
  });
  afterEach(() => cleanup());

  it('opens only after the status arrives, and paywall_shown carries the offer', async () => {
    const release = deferredFetch(statusResponse('welcome50'));
    render(<UpgradeParam />);
    await act(async () => {});
    expect(usePaywallStore.getState().open).toBe(false);
    expect(track).not.toHaveBeenCalled();

    await release();
    expect(usePaywallStore.getState().open).toBe(true);
    expect(track).toHaveBeenCalledTimes(1);
    expect(track).toHaveBeenCalledWith('paywall_shown', {
      feature: 'ai-edit',
      reason: 'daily_limit',
      offers: ['pro'],
      offer: 'welcome50',
    });
    expect(nav.replace).toHaveBeenCalledWith('/', { scroll: false });
  });

  it('opens without the offer for an ineligible user', async () => {
    const release = deferredFetch(statusResponse(null));
    render(<UpgradeParam />);
    await release();
    expect(track).toHaveBeenCalledWith('paywall_shown', { feature: 'ai-edit', reason: 'daily_limit', offers: ['pro'] });
  });

  it('still opens (without the offer) when the status request fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    global.fetch = vi.fn(async () => {
      await gate;
      throw new Error('offline');
    }) as any;
    render(<UpgradeParam />);
    await act(async () => release());
    expect(usePaywallStore.getState().open).toBe(true);
    expect(track).toHaveBeenCalledWith('paywall_shown', { feature: 'ai-edit', reason: 'daily_limit', offers: ['pro'] });
  });

  it('does nothing without the parameter', async () => {
    nav.search = '';
    const release = deferredFetch(statusResponse('welcome50'));
    render(<UpgradeParam />);
    await release();
    expect(usePaywallStore.getState().open).toBe(false);
    expect(nav.replace).not.toHaveBeenCalled();
  });
});
