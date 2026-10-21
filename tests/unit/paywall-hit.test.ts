import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  insert: vi.fn(),
  from: vi.fn(),
  track: vi.fn(),
}));

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    auth: { getSession: mocks.getSession },
    from: mocks.from,
  }),
}));

vi.mock('@/lib/analytics/track', () => ({ track: mocks.track }));

import { recordPaywallHit } from '@/lib/requests/paywall';
import { PaywallActions, usePaywallStore } from '@/stores/paywall';

describe('recordPaywallHit', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSession.mockResolvedValue({ data: { session: { user: { id: 'user-1' } } } });
    mocks.insert.mockResolvedValue({ error: null });
    mocks.from.mockReturnValue({ insert: mocks.insert });
  });

  it('inserts the hit for the signed-in user', async () => {
    await recordPaywallHit('export', 'pro_feature');
    expect(mocks.from).toHaveBeenCalledWith('paywall_hits');
    expect(mocks.insert).toHaveBeenCalledWith({ user_id: 'user-1', feature: 'export', reason: 'pro_feature' });
  });

  it('skips monthly_limit (a Pro user, not a lead) and signed-out visitors', async () => {
    await recordPaywallHit('ai-edit', 'monthly_limit');
    mocks.getSession.mockResolvedValue({ data: { session: null } });
    await recordPaywallHit('ai-edit', 'daily_limit');
    expect(mocks.insert).not.toHaveBeenCalled();
  });

  it('does nothing outside the browser (SSR)', async () => {
    vi.stubGlobal('window', undefined);
    try {
      await recordPaywallHit('export', 'pro_feature');
    } finally {
      vi.unstubAllGlobals();
    }
    expect(mocks.getSession).not.toHaveBeenCalled();
    expect(mocks.insert).not.toHaveBeenCalled();
  });

  it('swallows an insert error (pending migration, RLS) and a thrown client', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mocks.insert.mockResolvedValue({ error: { message: 'relation "paywall_hits" does not exist', code: '42P01' } });
    await expect(recordPaywallHit('ai-edit', 'daily_limit')).resolves.toBeUndefined();
    mocks.getSession.mockRejectedValue(new Error('offline'));
    await expect(recordPaywallHit('generate', 'generate_quota')).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(2);
    warn.mockRestore();
  });
});

describe('PaywallActions.open', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    usePaywallStore.setState({ open: false, feature: null, reason: null, offers: ['pro'] });
    mocks.getSession.mockResolvedValue({ data: { session: { user: { id: 'user-1' } } } });
    mocks.insert.mockResolvedValue({ error: null });
    mocks.from.mockReturnValue({ insert: mocks.insert });
  });

  it('records one hit when the dialog opens, none while it stays open', async () => {
    PaywallActions.open('ai-edit');
    PaywallActions.open('export');
    await vi.waitFor(() => expect(mocks.insert).toHaveBeenCalledTimes(1));
    expect(mocks.insert).toHaveBeenCalledWith({ user_id: 'user-1', feature: 'ai-edit', reason: 'daily_limit' });
    expect(mocks.track).toHaveBeenCalledTimes(1);
  });

  it('opens normally even when recording fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mocks.insert.mockRejectedValue(new Error('boom'));
    PaywallActions.open('export');
    expect(usePaywallStore.getState().open).toBe(true);
    await vi.waitFor(() => expect(warn).toHaveBeenCalled());
    warn.mockRestore();
  });
});
