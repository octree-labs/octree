import { describe, it, expect, beforeEach, vi } from 'vitest';
import { sseResponse } from '../helpers/responses';

/**
 * The counting decision for AI edits lives in POST /api/octra-agent: one
 * increment_edit_count call per served agent request, on the user session,
 * before the request is forwarded to the agent server. This pins:
 *   - free users are counted and stopped at FREE_DAILY_EDIT_LIMIT with
 *     `upgradeRequired: true` (the paywall and the limit_hit email key off it),
 *   - a free user's stale daily counter is not held against them (the RPC
 *     performs the lazy reset),
 *   - Pro users are counted and stopped at PRO_MONTHLY_EDIT_LIMIT without
 *     an upgrade prompt,
 *   - whitelisted accounts are never counted,
 *   - a false from the RPC (lost race) is a 429, not a served request.
 */

const mocks = vi.hoisted(() => {
  process.env.CLAUDE_AGENT_SERVICE_URL = 'https://agent.test/agent';
  const getSession = vi.fn();
  const single = vi.fn();
  const rpc = vi.fn();
  const insertSingle = vi.fn();
  const from = vi.fn(() => ({
    select: () => ({ eq: () => ({ single } ) }),
    insert: () => ({ select: () => ({ single: insertSingle }) }),
  }));
  const captureServerEventAfterResponse = vi.fn();
  return { getSession, single, rpc, insertSingle, from, captureServerEventAfterResponse };
});

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { getSession: mocks.getSession }, from: mocks.from, rpc: mocks.rpc }),
}));

vi.mock('@/lib/posthog-server', () => ({
  captureServerEventAfterResponse: mocks.captureServerEventAfterResponse,
  captureServerExceptionAfterResponse: vi.fn(),
}));

import { POST } from '@/app/api/octra-agent/route';
import { FREE_DAILY_EDIT_LIMIT, PRO_MONTHLY_EDIT_LIMIT } from '@/data/constants';

const today = new Date().toISOString().split('T')[0];

function request() {
  return new Request('http://localhost/api/octra-agent', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ messages: [{ role: 'user', content: 'hi' }], fileContent: '' }),
  });
}

function session(email = 'free@example.com') {
  return { data: { session: { access_token: 'tok', user: { id: 'user-1', email } } } };
}

function row(overrides: Record<string, unknown> = {}) {
  return {
    edit_count: 0,
    monthly_edit_count: 0,
    is_pro: false,
    daily_reset_date: today,
    monthly_reset_date: '2099-01-01',
    ...overrides,
  };
}

const spyOnFetch = () => vi.spyOn(global, 'fetch');

describe('POST /api/octra-agent: AI edit counting', () => {
  let fetchSpy: ReturnType<typeof spyOnFetch>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    mocks.getSession.mockResolvedValue(session());
    mocks.single.mockResolvedValue({ data: row(), error: null });
    mocks.rpc.mockResolvedValue({ data: true, error: null });
    fetchSpy = spyOnFetch().mockResolvedValue(
      sseResponse([{ event: 'done', data: { text: 'ok', edits: [] } }])
    );
  });

  it('increments once per served request, on the user session, before forwarding to the agent', async () => {
    const order: string[] = [];
    mocks.rpc.mockImplementation(async () => {
      order.push('rpc');
      return { data: true, error: null };
    });
    fetchSpy.mockImplementation(async () => {
      order.push('fetch');
      return sseResponse([{ event: 'done', data: { text: 'ok', edits: [] } }]);
    });

    const res = await POST(request());

    expect(res.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    expect(mocks.rpc).toHaveBeenCalledWith('increment_edit_count', { p_user_id: 'user-1' });
    expect(order).toEqual(['rpc', 'fetch']);
  });

  it('returns 429 with upgradeRequired for a free user at the daily limit and does not serve or count', async () => {
    mocks.single.mockResolvedValue({ data: row({ edit_count: FREE_DAILY_EDIT_LIMIT }), error: null });

    const res = await POST(request());

    expect(res.status).toBe(429);
    await expect(res.json()).resolves.toMatchObject({ limitReached: true, upgradeRequired: true });
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(mocks.captureServerEventAfterResponse).toHaveBeenCalledWith(
      'user-1',
      expect.any(String),
      expect.objectContaining({ is_pro: false })
    );
  });

  it('serves a free user whose daily counter is from a previous day (the RPC resets it)', async () => {
    mocks.single.mockResolvedValue({
      data: row({ edit_count: FREE_DAILY_EDIT_LIMIT, daily_reset_date: '2020-01-01' }),
      error: null,
    });

    const res = await POST(request());

    expect(res.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
  });

  it('counts a Pro user against the monthly cap and stops at the cap without an upgrade prompt', async () => {
    mocks.single.mockResolvedValue({ data: row({ is_pro: true, monthly_edit_count: PRO_MONTHLY_EDIT_LIMIT - 1 }), error: null });
    expect((await POST(request())).status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledTimes(1);

    mocks.single.mockResolvedValue({ data: row({ is_pro: true, monthly_edit_count: PRO_MONTHLY_EDIT_LIMIT }), error: null });
    const res = await POST(request());

    expect(res.status).toBe(429);
    await expect(res.json()).resolves.toMatchObject({ limitReached: true, upgradeRequired: false });
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
  });

  it('never counts a whitelisted account', async () => {
    // First entry of lib/paywall.ts UNLIMITED_EDIT_EMAILS.
    mocks.getSession.mockResolvedValue(session('rascodes123@gmail.com'));

    const res = await POST(request());

    expect(res.status).toBe(200);
    expect(mocks.from).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('returns 429 and does not serve when the RPC refuses the increment (lost race at the limit)', async () => {
    mocks.rpc.mockResolvedValue({ data: false, error: null });

    const res = await POST(request());

    expect(res.status).toBe(429);
    await expect(res.json()).resolves.toMatchObject({ limitReached: true, upgradeRequired: true });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('fails closed (500, not served) when the RPC errors', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'boom' } });
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const res = await POST(request());

    expect(res.status).toBe(500);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('creates the usage row for a brand-new user, then counts', async () => {
    mocks.single.mockResolvedValue({ data: null, error: { code: 'PGRST116' } });
    mocks.insertSingle.mockResolvedValue({ data: row(), error: null });

    const res = await POST(request());

    expect(res.status).toBe(200);
    expect(mocks.insertSingle).toHaveBeenCalledTimes(1);
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
  });
});
