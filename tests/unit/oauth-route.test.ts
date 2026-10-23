import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * app/auth/oauth/route.ts: the server-side `signup_completed` for OAuth
 * sign-ups is tagged `referral_source: 'tools'` when the sign-up came from a
 * tools draft, while the onboarding auto-complete stays gated on the narrower
 * isFromTools (deep link or tools referer).
 */

const DRAFT_ID = '11111111-2222-4333-8444-555555555555';
const USER_ID = 'user-1';

const mocks = vi.hoisted(() => {
  const exchangeCodeForSession = vi.fn();
  const usageMaybeSingle = vi.fn().mockResolvedValue({ data: null });
  const usageUpsert = vi.fn().mockResolvedValue({ error: null });
  const from = vi.fn(() => ({
    select: () => ({ eq: () => ({ maybeSingle: usageMaybeSingle }) }),
    upsert: usageUpsert,
  }));
  const captureServerEventAfterResponse = vi.fn();
  return { exchangeCodeForSession, usageMaybeSingle, usageUpsert, from, captureServerEventAfterResponse };
});

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { exchangeCodeForSession: mocks.exchangeCodeForSession },
    from: mocks.from,
  }),
}));

vi.mock('@/lib/posthog-server', () => ({
  captureServerEventAfterResponse: mocks.captureServerEventAfterResponse,
}));

import { GET } from '@/app/auth/oauth/route';

function request(query: string, headers: Record<string, string> = {}) {
  return new Request(`https://app.useoctree.com/auth/oauth?code=abc${query}`, {
    headers: { host: 'app.useoctree.com', ...headers },
  });
}

function signupProps() {
  const call = mocks.captureServerEventAfterResponse.mock.calls.find((c) => c[1] === 'signup_completed');
  return call?.[2];
}

describe('GET /auth/oauth signup_completed referral_source', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.usageMaybeSingle.mockResolvedValue({ data: null });
    mocks.exchangeCodeForSession.mockResolvedValue({
      data: {
        user: {
          id: USER_ID,
          created_at: new Date().toISOString(),
          app_metadata: { provider: 'google' },
        },
      },
      error: null,
    });
  });

  it('tags a draft sign-up (pending-draft cookie, provider referer) as tools without auto-completing onboarding', async () => {
    const res = await GET(
      request('', {
        cookie: `octree_pending_draft=${DRAFT_ID}`,
        referer: 'https://accounts.google.com/',
      })
    );
    expect(res.headers.get('location')).toBe('https://app.useoctree.com/import');
    expect(signupProps()).toEqual({ provider: 'google', referral_source: 'tools' });
    expect(mocks.usageUpsert).not.toHaveBeenCalled();
  });

  it('tags next=/import?draft=... as tools', async () => {
    await GET(request(`&next=${encodeURIComponent(`/import?draft=${DRAFT_ID}`)}`));
    expect(signupProps()).toEqual({ provider: 'google', referral_source: 'tools' });
    expect(mocks.usageUpsert).not.toHaveBeenCalled();
  });

  it('leaves a plain sign-up untagged', async () => {
    await GET(request(''));
    expect(signupProps()).toEqual({ provider: 'google' });
    expect(mocks.usageUpsert).not.toHaveBeenCalled();
  });

  it('does not treat a lookalike path (/imports) as tools', async () => {
    await GET(request('&next=/imports'));
    expect(signupProps()).toEqual({ provider: 'google' });
  });

  it('still auto-completes onboarding for a tools referer and tags the event', async () => {
    await GET(request('', { referer: 'https://tools.useoctree.com/x' }));
    expect(signupProps()).toEqual({ provider: 'google', referral_source: 'tools' });
    expect(mocks.usageUpsert).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: USER_ID, onboarding_completed: true, referral_source: 'tools' }),
      { onConflict: 'user_id' }
    );
  });

  it('does not capture signup_completed for an existing account', async () => {
    mocks.exchangeCodeForSession.mockResolvedValue({
      data: { user: { id: USER_ID, created_at: '2020-01-01T00:00:00Z', app_metadata: { provider: 'google' } } },
      error: null,
    });
    await GET(request('', { cookie: `octree_pending_draft=${DRAFT_ID}` }));
    expect(signupProps()).toBeUndefined();
  });
});
