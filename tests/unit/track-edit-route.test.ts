import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * app/api/track-edit/route.ts has two Supabase clients: the user session for
 * reads and the increment_edit_count RPC, and the service-role client for the
 * writes the user_usage guard trigger refuses from `authenticated` (row
 * inserts, counter resets, the whitelisted-user update). These tests pin
 * which client each write goes to; a write that drifts back to the user
 * session would be rejected by the trigger in production.
 */

const mocks = vi.hoisted(() => {
  const getUser = vi.fn();
  const rpc = vi.fn();

  const userSingle = vi.fn();
  const userSelectEq = vi.fn(() => ({ single: userSingle }));
  const userSelect = vi.fn(() => ({ eq: userSelectEq }));
  const userUpdate = vi.fn();
  const userInsert = vi.fn();
  const userFrom = vi.fn(() => ({ select: userSelect, update: userUpdate, insert: userInsert }));

  const adminUpdateSingle = vi.fn();
  const adminUpdateSelect = vi.fn(() => ({ single: adminUpdateSingle }));
  const adminUpdateEq = vi.fn(() => {
    const result = Promise.resolve({ error: null }) as Promise<unknown> & { select: typeof adminUpdateSelect };
    result.select = adminUpdateSelect;
    return result;
  });
  const adminUpdate = vi.fn(() => ({ eq: adminUpdateEq }));
  const adminInsertSingle = vi.fn();
  const adminInsertSelect = vi.fn(() => ({ single: adminInsertSingle }));
  const adminInsert = vi.fn(() => ({ select: adminInsertSelect }));
  const adminFrom = vi.fn(() => ({ update: adminUpdate, insert: adminInsert }));

  return {
    getUser, rpc,
    userFrom, userSingle, userUpdate, userInsert,
    adminFrom, adminUpdate, adminUpdateEq, adminUpdateSingle, adminInsert, adminInsertSingle,
  };
});

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: mocks.getUser },
    from: mocks.userFrom,
    rpc: mocks.rpc,
  }),
}));

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({ from: mocks.adminFrom }),
}));

import { GET, POST } from '@/app/api/track-edit/route';

const freeUser = { id: 'user-1', email: 'free@example.com' };
// First entry of lib/paywall.ts UNLIMITED_EDIT_EMAILS.
const unlimitedUser = { id: 'user-2', email: 'rascodes123@gmail.com' };

const today = new Date().toISOString().split('T')[0];
const nextMonth = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

function freeRow(overrides: Record<string, unknown> = {}) {
  return {
    edit_count: 2,
    monthly_edit_count: 0,
    daily_reset_date: today,
    monthly_reset_date: nextMonth,
    is_pro: false,
    subscription_status: 'inactive',
    ...overrides,
  };
}

describe('track-edit route: which client writes user_usage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getUser.mockResolvedValue({ data: { user: freeUser }, error: null });
    mocks.userSingle.mockResolvedValue({ data: freeRow(), error: null });
    mocks.rpc.mockResolvedValue({ data: true, error: null });
    mocks.adminUpdateSingle.mockResolvedValue({ data: freeRow(), error: null });
    mocks.adminInsertSingle.mockResolvedValue({ data: freeRow({ edit_count: 0 }), error: null });
  });

  it('POST for a free user increments through the RPC on the user session and writes nothing else', async () => {
    const res = await POST();

    expect(res.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith('increment_edit_count', { p_user_id: 'user-1' });
    expect(mocks.userUpdate).not.toHaveBeenCalled();
    expect(mocks.userInsert).not.toHaveBeenCalled();
    expect(mocks.adminFrom).not.toHaveBeenCalled();
  });

  it('POST creates a missing row through the service-role client', async () => {
    mocks.userSingle
      .mockResolvedValueOnce({ data: null, error: { code: 'PGRST116' } })
      .mockResolvedValue({ data: freeRow({ edit_count: 1 }), error: null });

    const res = await POST();

    expect(res.status).toBe(200);
    expect(mocks.adminFrom).toHaveBeenCalledWith('user_usage');
    expect(mocks.adminInsert).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: 'user-1', is_pro: false, subscription_status: 'inactive' })
    );
    expect(mocks.userInsert).not.toHaveBeenCalled();
  });

  it('POST resets a lapsed monthly count through the service-role client', async () => {
    mocks.userSingle.mockResolvedValue({ data: freeRow({ monthly_reset_date: '2020-01-01' }), error: null });

    await POST();

    expect(mocks.adminUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ monthly_edit_count: 0 })
    );
    expect(mocks.adminUpdateEq).toHaveBeenCalledWith('user_id', 'user-1');
    expect(mocks.userUpdate).not.toHaveBeenCalled();
  });

  it('POST for a whitelisted user writes the counters and is_pro through the service-role client', async () => {
    mocks.getUser.mockResolvedValue({ data: { user: unlimitedUser }, error: null });
    mocks.adminUpdateSingle.mockResolvedValue({
      data: freeRow({ edit_count: 3, monthly_edit_count: 1, is_pro: true, subscription_status: 'unlimited' }),
      error: null,
    });

    const res = await POST();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.hasUnlimitedEdits).toBe(true);
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.adminUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ edit_count: 3, monthly_edit_count: 1, is_pro: true, subscription_status: 'unlimited' })
    );
    expect(mocks.adminUpdateEq).toHaveBeenCalledWith('user_id', 'user-2');
    expect(mocks.userUpdate).not.toHaveBeenCalled();
  });

  it('GET resets a lapsed daily count through the service-role client', async () => {
    mocks.userSingle.mockResolvedValue({ data: freeRow({ daily_reset_date: '2020-01-01' }), error: null });

    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.editCount).toBe(0);
    expect(mocks.adminUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ edit_count: 0, daily_reset_date: expect.any(String) })
    );
    expect(mocks.userUpdate).not.toHaveBeenCalled();
  });

  it('GET only reads when nothing needs resetting', async () => {
    const res = await GET();

    expect(res.status).toBe(200);
    expect(mocks.adminFrom).not.toHaveBeenCalled();
    expect(mocks.userUpdate).not.toHaveBeenCalled();
  });
});
