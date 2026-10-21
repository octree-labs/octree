import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';

import { PaywallDialog } from '@/components/subscription/paywall-dialog';
import { PaywallActions, usePaywallStore } from '@/stores/paywall';

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
 * pass means the dialog without the offer is byte-for-byte unchanged.
 */
const VARIANTS = [
  ['export', () => PaywallActions.open('export')],
  ['ai-edit daily_limit', () => PaywallActions.open('ai-edit', 'daily_limit')],
  ['ai-edit monthly_limit', () => PaywallActions.open('ai-edit', 'monthly_limit')],
  ['generate pro_feature', () => PaywallActions.open('generate')],
  ['generate generate_quota (pro + single)', () => PaywallActions.open('generate', 'generate_quota', ['pro', 'single'])],
] as const;

function resetStore() {
  PaywallActions.close();
  usePaywallStore.setState({ open: false, feature: null, reason: null, offers: ['pro'] });
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
      expect(document.body.innerHTML).toMatchSnapshot();
    });
  }
});
