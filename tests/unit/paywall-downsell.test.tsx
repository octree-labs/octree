import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

import { PaywallDialog } from '@/components/subscription/paywall-dialog';
import { PaywallActions, usePaywallStore } from '@/stores/paywall';
import { createCheckoutSession } from '@/lib/requests/subscription';
import { track } from '@/lib/analytics/track';

const offer = vi.hoisted(() => ({ variant: 'offer_v2' as 'offer_v2' | 'control' }));

vi.mock('@/hooks/use-offer', () => ({
  useOffer: () => ({ variant: offer.variant }),
  useCountdown: () => null,
}));
vi.mock('@/lib/requests/subscription', () => ({
  createCheckoutSession: vi.fn(() => new Promise(() => {})),
}));
vi.mock('@/lib/requests/paywall', () => ({ recordPaywallHit: vi.fn(async () => {}) }));
vi.mock('@/lib/analytics/track', () => ({ track: vi.fn() }));

function reset() {
  PaywallActions.close();
  usePaywallStore.setState({
    open: false,
    feature: null,
    reason: null,
    offers: ['pro'],
    firstPurchaseOffer: null,
    context: null,
    offerVariant: null,
  });
  window.localStorage.clear();
}

describe('in-product paywall under offer_v2', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    offer.variant = 'offer_v2';
    reset();
  });
  afterEach(() => cleanup());

  it('shows the value stack and the guarantee', () => {
    PaywallActions.open('export');
    render(<PaywallDialog />);
    expect(screen.getByText(/Unlimited PDF and ZIP export/)).toBeTruthy();
    expect(screen.getByText(/7-day money-back guarantee/)).toBeTruthy();
  });

  it('closing once shows the Deadline Pass downsell; "No thanks" closes; it never shows again', () => {
    PaywallActions.open('export');
    const { rerender } = render(<PaywallDialog />);
    fireEvent.click(screen.getByRole('button', { name: 'Not now' }));

    expect(usePaywallStore.getState().open).toBe(true);
    expect(screen.getByText('Only need Pro for one deadline?')).toBeTruthy();
    expect(track).toHaveBeenCalledWith('paywall_downsell_shown', {
      placement: 'dialog',
      offers: ['pass'],
      offer_variant: 'offer_v2',
      feature: 'export',
    });

    fireEvent.click(screen.getByRole('button', { name: 'No thanks' }));
    rerender(<PaywallDialog />);
    expect(usePaywallStore.getState().open).toBe(false);

    PaywallActions.open('export');
    rerender(<PaywallDialog />);
    fireEvent.click(screen.getByRole('button', { name: 'Not now' }));
    expect(usePaywallStore.getState().open).toBe(false);
  });

  it('the downsell buys the Deadline Pass', () => {
    PaywallActions.open('ai-edit', 'daily_limit');
    render(<PaywallDialog />);
    fireEvent.click(screen.getByRole('button', { name: 'Not now' }));
    fireEvent.click(screen.getByRole('button', { name: /Get 7 days for/ }));
    expect(createCheckoutSession).toHaveBeenCalledWith({ plan: 'deadline_pass', source: 'paywall' });
  });

  it('offers the paywall\'s own one-off next to the pass', () => {
    PaywallActions.open('generate', 'generate_quota', ['pro', 'single']);
    render(<PaywallDialog />);
    fireEvent.click(screen.getByRole('button', { name: 'Not now' }));
    expect(screen.getByText('Deadline Pass')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Generate this one/ })).toBeTruthy();
  });

  it('control closes straight away', () => {
    offer.variant = 'control';
    PaywallActions.open('export');
    render(<PaywallDialog />);
    fireEvent.click(screen.getByRole('button', { name: 'Not now' }));
    expect(usePaywallStore.getState().open).toBe(false);
    expect(track).not.toHaveBeenCalledWith('paywall_downsell_shown', expect.anything());
  });
});
