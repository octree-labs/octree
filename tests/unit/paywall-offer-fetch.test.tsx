import { describe, it, expect, afterEach, vi } from 'vitest';
import { cleanup, render, waitFor } from '@testing-library/react';

import { PaywallDialog } from '@/components/subscription/paywall-dialog';
import { PaywallActions, usePaywallStore } from '@/stores/paywall';

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({ auth: { getSession: async () => ({ data: { session: { user: { id: 'user-42' } } } }) } }),
}));
vi.mock('@/lib/requests/paywall', () => ({ recordPaywallHit: vi.fn(async () => {}) }));
vi.mock('@/lib/analytics/track', () => ({ track: vi.fn() }));

describe('GET /api/offer is asked only when the paywall opens', () => {
  afterEach(() => {
    cleanup();
    PaywallActions.close();
    usePaywallStore.setState({ open: false, offerVariant: null });
  });

  it('a mounted, closed dialog does not assign the experiment; opening it does', async () => {
    const fetchSpy = vi.fn(async (url: string) => ({
      ok: true,
      json: async () => (url === '/api/offer' ? { variant: 'offer_v2' } : { tier: 'standard' }),
    }));
    global.fetch = fetchSpy as any;

    const { rerender } = render(<PaywallDialog />);
    await new Promise((r) => setTimeout(r, 20));
    expect(fetchSpy.mock.calls.some(([url]) => url === '/api/offer')).toBe(false);

    PaywallActions.open('export');
    rerender(<PaywallDialog />);
    await waitFor(() => expect(fetchSpy.mock.calls.some(([url]) => url === '/api/offer')).toBe(true));
    await waitFor(() => expect(usePaywallStore.getState().offerVariant).toBe('offer_v2'));
  });
});
