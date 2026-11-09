import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * app/api/sso/route.ts signs a tools.useoctree.com user in and, when draft
 * content rides along, stores it as a draft and redirects to /import. Drafts
 * are service-role only (20261109140000_drafts_no_public_select), so the
 * session client must only set the session, never touch `drafts`.
 */

const DRAFT_ID = '11111111-2222-4333-8444-555555555555';

const mocks = vi.hoisted(() => {
  const single = vi.fn();
  const select = vi.fn(() => ({ single }));
  const insert = vi.fn(() => ({ select }));
  const adminFrom = vi.fn(() => ({ insert }));
  const setSession = vi.fn();
  const sessionFrom = vi.fn(() => {
    throw new Error('drafts must not be written with the session client');
  });
  return { single, select, insert, adminFrom, setSession, sessionFrom };
});

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({ from: mocks.adminFrom }),
}));
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { setSession: mocks.setSession }, from: mocks.sessionFrom }),
}));

import { POST } from '@/app/api/sso/route';

function jsonPost(body: Record<string, unknown>) {
  return new Request('https://app.useoctree.com/api/sso', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }) as any;
}

const TOKENS = { access_token: 'a', refresh_token: 'r' };

describe('POST /api/sso', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.setSession.mockResolvedValue({ error: null });
    mocks.single.mockResolvedValue({ data: { id: DRAFT_ID }, error: null });
  });

  it('stores the draft with the service role and redirects to /import', async () => {
    const res = await POST(jsonPost({ ...TOKENS, content: '\\section{Hi}', title: 'T', source: 'tools' }));
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe(`https://app.useoctree.com/import?draft=${DRAFT_ID}`);
    expect(mocks.adminFrom).toHaveBeenCalledWith('drafts');
    expect(mocks.insert).toHaveBeenCalledWith({ content: '\\section{Hi}', title: 'T', source: 'tools' });
    expect(mocks.sessionFrom).not.toHaveBeenCalled();
  });

  it('does not store a draft when the session is invalid', async () => {
    mocks.setSession.mockResolvedValue({ error: new Error('bad jwt') });
    const res = await POST(jsonPost({ ...TOKENS, content: 'x' }));
    expect(res.status).toBe(401);
    expect(mocks.adminFrom).not.toHaveBeenCalled();
  });

  it('signs in without a draft when the content is over the /api/drafts cap', async () => {
    const res = await POST(jsonPost({ ...TOKENS, content: 'x'.repeat(200_001), next: '/projects' }));
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe('https://app.useoctree.com/projects');
    expect(mocks.adminFrom).not.toHaveBeenCalled();
  });
});
