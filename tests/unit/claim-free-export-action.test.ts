import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * actions/claim-free-export.ts: the server grants the free first export
 * (never the browser), skips entitled users and captures export_free_used.
 */

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  usageRow: vi.fn(),
  rpc: vi.fn(),
  captureEvent: vi.fn(),
  captureException: vi.fn(),
  enabled: { value: true },
}));

vi.mock('@/data/constants', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/data/constants')>();
  return {
    ...actual,
    get FREE_FIRST_EXPORT_ENABLED() {
      return mocks.enabled.value;
    },
  };
});

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: mocks.getUser },
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: mocks.usageRow }) }) }),
  }),
}));

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({ rpc: mocks.rpc }),
}));

vi.mock('@/lib/posthog-server', () => ({
  captureServerEventAfterResponse: mocks.captureEvent,
  captureServerExceptionAfterResponse: mocks.captureException,
}));

vi.mock('@/lib/paywall', () => ({
  hasUnlimitedEdits: (email: string | null | undefined) => email === 'boss@example.com',
}));

import { claimFreeFirstExport } from '@/actions/claim-free-export';

const projectId = '11111111-2222-4333-8444-555555555555';

describe('claimFreeFirstExport', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.enabled.value = true;
    mocks.getUser.mockResolvedValue({ data: { user: { id: 'user-1', email: 'a@example.com' } } });
    mocks.usageRow.mockResolvedValue({ data: { subscription_status: 'inactive' }, error: null });
    mocks.rpc.mockResolvedValue({ data: 'granted', error: null });
  });

  it('grants the first export through the RPC and captures export_free_used', async () => {
    expect(await claimFreeFirstExport(projectId, 'pdf')).toEqual({ status: 'granted' });
    expect(mocks.rpc).toHaveBeenCalledWith('claim_free_first_export', {
      p_user_id: 'user-1',
      p_project_id: projectId,
    });
    expect(mocks.captureEvent).toHaveBeenCalledWith('user-1', 'export_free_used', {
      project_id: projectId,
      format: 'pdf',
    });
  });

  it('second export elsewhere: used, nothing captured', async () => {
    mocks.rpc.mockResolvedValue({ data: 'used', error: null });
    expect(await claimFreeFirstExport(projectId, 'zip')).toEqual({ status: 'used' });
    expect(mocks.captureEvent).not.toHaveBeenCalled();
  });

  it('an active Pro row is answered unlocked without spending the free export', async () => {
    mocks.usageRow.mockResolvedValue({
      data: {
        subscription_status: 'active',
        stripe_subscription_id: 'sub_1',
        current_period_end: new Date(Date.now() + 86_400_000).toISOString(),
      },
      error: null,
    });
    expect(await claimFreeFirstExport(projectId, 'pdf')).toEqual({ status: 'unlocked' });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('an allowlisted account is unlocked without the RPC', async () => {
    mocks.getUser.mockResolvedValue({ data: { user: { id: 'user-2', email: 'boss@example.com' } } });
    expect(await claimFreeFirstExport(projectId, 'pdf')).toEqual({ status: 'unlocked' });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('kill switch off: unavailable, no RPC', async () => {
    mocks.enabled.value = false;
    expect(await claimFreeFirstExport(projectId, 'pdf')).toEqual({ status: 'unavailable' });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('refuses a bad project id or format, and an anonymous caller', async () => {
    expect(await claimFreeFirstExport('not-a-uuid', 'pdf')).toEqual({ status: 'unavailable' });
    expect(await claimFreeFirstExport(projectId, 'docx' as any)).toEqual({ status: 'unavailable' });
    mocks.getUser.mockResolvedValue({ data: { user: null } });
    expect(await claimFreeFirstExport(projectId, 'pdf')).toEqual({ status: 'unavailable' });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('migration not applied: unavailable (the paywall shows as before), not an exception', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: 'PGRST202' } });
    expect(await claimFreeFirstExport(projectId, 'pdf')).toEqual({ status: 'unavailable' });
    expect(mocks.captureException).not.toHaveBeenCalled();
  });

  it('a database error is reported and answered unavailable', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: '500', message: 'boom' } });
    expect(await claimFreeFirstExport(projectId, 'pdf')).toEqual({ status: 'unavailable' });
    expect(mocks.captureException).toHaveBeenCalled();
  });
});
