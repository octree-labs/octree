import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

import { PaywallDialog } from '@/components/subscription/paywall-dialog';
import { PaywallActions, usePaywallStore } from '@/stores/paywall';
import { isExportUnlocked, useProjectStore } from '@/stores/project';
import { createCheckoutSession } from '@/lib/requests/subscription';
import { track } from '@/lib/analytics/track';

vi.mock('@/lib/requests/subscription', () => ({
  createCheckoutSession: vi.fn(() => new Promise(() => {})),
}));

vi.mock('@/lib/requests/paywall', () => ({
  recordPaywallHit: vi.fn(async () => {}),
}));

vi.mock('@/lib/analytics/track', () => ({
  track: vi.fn(),
}));

/**
 * Every paywall variant, as an ineligible user sees it. The snapshots in
 * __snapshots__/paywall-dialog-offer.test.tsx.snap were written from the
 * dialog BEFORE the first-purchase offer existed (main at c0d0321), so a
 * pass means the dialog without the offer is byte-for-byte unchanged
 * (Radix/useId ids renumbered by `stableIds`).
 */
const VARIANTS = [
  ['export', () => PaywallActions.open('export')],
  ['ai-edit daily_limit', () => PaywallActions.open('ai-edit', 'daily_limit')],
  ['ai-edit monthly_limit', () => PaywallActions.open('ai-edit', 'monthly_limit')],
  ['generate pro_feature', () => PaywallActions.open('generate')],
  ['generate generate_quota (pro + single)', () => PaywallActions.open('generate', 'generate_quota', ['pro', 'single'])],
] as const;

/**
 * React's useId (behind Radix's ids) counts across every root in the test
 * file, so raw ids depend on which tests ran first. Renumber them by first
 * appearance within the snapshot: the aria-labelledby / aria-describedby
 * links stay checked, and each snapshot is the same run alone or shuffled.
 */
function stableIds(html: string): string {
  const seen = new Map<string, string>();
  return html.replace(/«[^»]+»|:r[0-9a-z]+:/g, (id) => {
    if (!seen.has(id)) seen.set(id, `«id${seen.size}»`);
    return seen.get(id)!;
  });
}

function resetStore() {
  PaywallActions.close();
  usePaywallStore.setState({ open: false, feature: null, reason: null, offers: ['pro'], firstPurchaseOffer: null, context: null });
}

describe('PaywallDialog without a first-purchase offer (unchanged)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetStore();
  });
  afterEach(() => cleanup());

  for (const [name, open] of VARIANTS) {
    it(`renders ${name} exactly as before`, () => {
      open();
      render(<PaywallDialog />);
      expect(stableIds(document.body.innerHTML)).toMatchSnapshot();
    });
  }
});

describe('PaywallDialog with the first-purchase offer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetStore();
    PaywallActions.setFirstPurchaseOffer('welcome50');
  });
  afterEach(() => cleanup());

  it('shows the offer on the plan picker paywall and passes it to a monthly checkout', async () => {
    PaywallActions.open('export');
    render(<PaywallDialog />);

    // The crossed-out price and the button carry the offer; no separate note.
    expect(screen.getByText('$4.99')).toBeInTheDocument();
    expect(screen.queryByText(/applied at checkout/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Go Pro with 50% off' }));

    await waitFor(() => expect(createCheckoutSession).toHaveBeenCalledTimes(1));
    expect(vi.mocked(createCheckoutSession).mock.calls[0][0]).toEqual({
      plan: 'monthly',
      withTrial: false,
      source: 'paywall',
      offer: 'welcome50',
    });
  });

  it.each([
    ['ai-edit', true],
    ['export', false],
    ['generate', false],
    ['ats', false],
  ] as const)('shows the AI edit credit pack on the %s paywall: %s', (feature, shown) => {
    PaywallActions.open(feature);
    render(<PaywallDialog />);
    expect(!!screen.queryByRole('button', { name: /^Buy 100 AI edits/ })).toBe(shown);
  });

  it('drops the offer when the annual plan is picked', async () => {
    PaywallActions.open('ai-edit', 'daily_limit');
    render(<PaywallDialog />);

    fireEvent.click(screen.getByRole('radio', { name: /annual/i }));
    expect(screen.queryByText('50% off your first month, applied at checkout')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Get Octree Pro' }));

    await waitFor(() => expect(createCheckoutSession).toHaveBeenCalledTimes(1));
    expect(vi.mocked(createCheckoutSession).mock.calls[0][0]).toEqual({
      plan: 'annual',
      withTrial: false,
      source: 'paywall',
    });
  });

  it('shows the offer on the Pro card of the generate quota paywall; the one-off card is untouched', async () => {
    PaywallActions.open('generate', 'generate_quota', ['pro', 'single']);
    render(<PaywallDialog />);

    expect(screen.getByText('$4.99 first month, then $9.99/mo')).toBeInTheDocument();
    // The two-card layout keeps it short: the price line and the button carry the offer.
    expect(screen.queryByText(/applied at checkout/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Generate this one — $2.99' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Go Pro with 50% off' }));
    await waitFor(() => expect(createCheckoutSession).toHaveBeenCalledTimes(1));
    expect(vi.mocked(createCheckoutSession).mock.calls[0][0]).toEqual({
      plan: 'monthly',
      withTrial: false,
      source: 'paywall',
      offer: 'welcome50',
    });
  });

  it('keeps the one-off generation checkout free of the offer', async () => {
    PaywallActions.open('generate', 'generate_quota', ['pro', 'single']);
    render(<PaywallDialog />);

    fireEvent.click(screen.getByRole('button', { name: 'Generate this one — $2.99' }));
    await waitFor(() => expect(createCheckoutSession).toHaveBeenCalledTimes(1));
    expect(vi.mocked(createCheckoutSession).mock.calls[0][0]).toEqual({ plan: 'generate_single', source: 'paywall' });
  });

  it('never shows the offer on the monthly_limit (credits only) paywall', () => {
    PaywallActions.open('ai-edit', 'monthly_limit');
    const { container } = render(<PaywallDialog />);
    expect(screen.queryByText(/applied at checkout/)).not.toBeInTheDocument();
    expect(container.ownerDocument.body.innerHTML).not.toContain('first month');
  });

  it('adds offer to paywall_shown only when the offer is shown', () => {
    PaywallActions.open('export');
    expect(track).toHaveBeenLastCalledWith('paywall_shown', {
      feature: 'export',
      reason: 'pro_feature',
      offers: ['pro'],
      offer: 'welcome50',
    });

    resetStore();
    PaywallActions.setFirstPurchaseOffer('welcome50');
    PaywallActions.open('ai-edit', 'monthly_limit');
    expect(track).toHaveBeenLastCalledWith('paywall_shown', {
      feature: 'ai-edit',
      reason: 'monthly_limit',
      offers: ['pro'],
    });

    resetStore();
    PaywallActions.open('export');
    expect(track).toHaveBeenLastCalledWith('paywall_shown', {
      feature: 'export',
      reason: 'pro_feature',
      offers: ['pro'],
    });
  });
});

const PROJECT_ID = '2f1c7d4e-8a9b-4c3d-9e2f-1a2b3c4d5e6f';
const openExportSingle = () => PaywallActions.open('export', 'pro_feature', ['single', 'pro'], { projectId: PROJECT_ID });

describe('PaywallDialog export with the one-off "Export this document" offer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetStore();
  });
  afterEach(() => cleanup());

  it('renders the two-card layout: the $4.99 one-off first, then the Pro card', () => {
    openExportSingle();
    render(<PaywallDialog />);

    expect(screen.getByText('Export this document', { selector: 'p' })).toBeInTheDocument();
    expect(screen.getByText('$4.99 once')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Unlock export' })).toBeInTheDocument();
    expect(screen.getByText('Octree Pro')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Go Pro for $9.99/mo' })).toBeInTheDocument();
    // Not the plan picker layout.
    expect(screen.queryByRole('radio')).not.toBeInTheDocument();
    expect(stableIds(document.body.innerHTML)).toMatchSnapshot();
  });

  it('starts an export_single checkout for the project from the paywall', async () => {
    openExportSingle();
    render(<PaywallDialog />);

    fireEvent.click(screen.getByRole('button', { name: 'Unlock export' }));
    await waitFor(() => expect(createCheckoutSession).toHaveBeenCalledTimes(1));
    expect(vi.mocked(createCheckoutSession).mock.calls[0][0]).toEqual({
      plan: 'export_single',
      projectId: PROJECT_ID,
      source: 'paywall',
    });
  });

  it('shows the first-purchase offer on the Pro card only; the one-off checkout carries no offer', async () => {
    PaywallActions.setFirstPurchaseOffer('welcome50');
    openExportSingle();
    render(<PaywallDialog />);

    expect(screen.getByText('$4.99 first month, then $9.99/mo')).toBeInTheDocument();
    expect(screen.queryByText(/applied at checkout/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Unlock export' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Unlock export' }));
    await waitFor(() => expect(createCheckoutSession).toHaveBeenCalledTimes(1));
    expect(vi.mocked(createCheckoutSession).mock.calls[0][0]).toEqual({
      plan: 'export_single',
      projectId: PROJECT_ID,
      source: 'paywall',
    });
  });

  it('the Pro card still buys the monthly plan with the offer', async () => {
    PaywallActions.setFirstPurchaseOffer('welcome50');
    openExportSingle();
    render(<PaywallDialog />);

    fireEvent.click(screen.getByRole('button', { name: 'Go Pro with 50% off' }));
    await waitFor(() => expect(createCheckoutSession).toHaveBeenCalledTimes(1));
    expect(vi.mocked(createCheckoutSession).mock.calls[0][0]).toEqual({
      plan: 'monthly',
      withTrial: false,
      source: 'paywall',
      offer: 'welcome50',
    });
  });

  it('closes and marks the project unlocked when checkout answers "already unlocked" (409)', async () => {
    vi.mocked(createCheckoutSession).mockRejectedValueOnce(new Error('Export is already unlocked for this project'));
    useProjectStore.setState({ exportUnlocked: false, exportUnlockProjectId: null });
    openExportSingle();
    render(<PaywallDialog />);

    fireEvent.click(screen.getByRole('button', { name: 'Unlock export' }));
    await waitFor(() => expect(usePaywallStore.getState().open).toBe(false));
    expect(isExportUnlocked(useProjectStore.getState(), PROJECT_ID)).toBe(true);
  });

  it('falls back to the plain export paywall when no project was passed', () => {
    PaywallActions.open('export', 'pro_feature', ['single', 'pro']);
    render(<PaywallDialog />);
    expect(screen.queryByRole('button', { name: /Unlock export/ })).not.toBeInTheDocument();
    expect(screen.getByText('Export is a Pro feature')).toBeInTheDocument();
  });

  it('reports both offers on paywall_shown', () => {
    openExportSingle();
    expect(track).toHaveBeenLastCalledWith('paywall_shown', {
      feature: 'export',
      reason: 'pro_feature',
      offers: ['single', 'pro'],
    });
  });
});

describe('paywall store context', () => {
  beforeEach(() => resetStore());

  it('carries the context of the open and resets it on the next open', () => {
    openExportSingle();
    expect(usePaywallStore.getState().context).toEqual({ projectId: PROJECT_ID });

    PaywallActions.close();
    PaywallActions.open('ai-edit', 'daily_limit');
    expect(usePaywallStore.getState().context).toBeNull();
  });
});

describe('useSubscriptionUsage feeds the paywall store', () => {
  afterEach(() => cleanup());

  it('stores the first_purchase_offer from the status response, so the dialog needs no request', async () => {
    const { renderHook } = await import('@testing-library/react');
    const { useSubscriptionUsage } = await import('@/hooks/use-subscription-usage');
    resetStore();
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        hasSubscription: false,
        usage: { isPro: false, hasUnlimitedEdits: false, limitReached: true, monthlyLimitReached: false },
        first_purchase_offer: 'welcome50',
      }),
    }) as any;

    renderHook(() => useSubscriptionUsage());
    await waitFor(() => expect(usePaywallStore.getState().firstPurchaseOffer).toBe('welcome50'));
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });
});
