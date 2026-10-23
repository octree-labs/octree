import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * app/import/route.ts turns a tools.useoctree.com draft into a project.
 * Supabase and Reddit CAPI are mocked; the tests pin where the draft id is
 * read from (query vs cookie), the logged-out landing, the consumption
 * UPDATE, the cookie clearing and the redirect target.
 */

const DRAFT_ID = '11111111-2222-4333-8444-555555555555';
const COOKIE_DRAFT_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const PROJECT_ID = 'project-1';

const mocks = vi.hoisted(() => {
  const getUser = vi.fn();
  const draftMaybeSingle = vi.fn();
  const draftSelectEq = vi.fn(() => ({ maybeSingle: draftMaybeSingle }));
  const draftSelect = vi.fn(() => ({ eq: draftSelectEq }));
  const draftUpdateSelect = vi.fn();
  const draftUpdateIs = vi.fn(() => ({ select: draftUpdateSelect }));
  const draftUpdateEq = vi.fn(() => ({ is: draftUpdateIs }));
  const draftUpdate = vi.fn(() => ({ eq: draftUpdateEq }));

  const projectSingle = vi.fn();
  const projectInsert = vi.fn(() => ({ select: () => ({ single: projectSingle }) }));
  const projectDeleteEq = vi.fn().mockResolvedValue({ error: null });
  const projectDelete = vi.fn(() => ({ eq: projectDeleteEq }));

  const fileInsert = vi.fn().mockResolvedValue({ error: null });

  const upload = vi.fn().mockResolvedValue({ error: null });
  const remove = vi.fn().mockResolvedValue({ error: null });
  const getPublicUrl = vi.fn(() => ({ data: { publicUrl: 'https://cdn/main.tex' } }));

  const from = vi.fn((table: string) => {
    if (table === 'drafts') return { select: draftSelect, update: draftUpdate };
    if (table === 'projects') return { insert: projectInsert, delete: projectDelete };
    if (table === 'files') return { insert: fileInsert };
    throw new Error(`unexpected table ${table}`);
  });

  const trackRedditConversion = vi.fn().mockResolvedValue(undefined);

  return {
    getUser,
    draftSelectEq,
    draftMaybeSingle,
    draftUpdate,
    draftUpdateEq,
    draftUpdateIs,
    draftUpdateSelect,
    projectInsert,
    projectSingle,
    projectDeleteEq,
    fileInsert,
    upload,
    remove,
    getPublicUrl,
    from,
    trackRedditConversion,
  };
});

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: mocks.getUser },
    from: mocks.from,
    storage: {
      from: () => ({ upload: mocks.upload, remove: mocks.remove, getPublicUrl: mocks.getPublicUrl }),
    },
  }),
}));

vi.mock('@/lib/reddit-capi', () => ({
  trackRedditConversion: mocks.trackRedditConversion,
}));

import { GET } from '@/app/import/route';

function makeRequest(path: string, cookie?: string) {
  return new NextRequest(`https://app.useoctree.com${path}`, {
    headers: cookie ? { cookie } : {},
  });
}

function draftRow(overrides: Record<string, unknown> = {}) {
  return {
    id: DRAFT_ID,
    title: 'My doc',
    content: '\\documentclass{article}\n\\begin{document}hi\\end{document}',
    source: 'tools:templates',
    consumed_at: null,
    consumed_by: null,
    project_id: null,
    ...overrides,
  };
}

function user(createdAt: Date, provider = 'google') {
  return {
    id: 'user-1',
    email: 'new@example.com',
    created_at: createdAt.toISOString(),
    app_metadata: { provider, providers: [provider] },
  };
}

const oldUser = () => user(new Date(Date.now() - 2 * 60 * 60 * 1000));
const freshUser = () => user(new Date(Date.now() - 60 * 1000));
const freshEmailUser = () => user(new Date(Date.now() - 60 * 1000), 'email');

describe('GET /import', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.draftMaybeSingle.mockResolvedValue({ data: draftRow(), error: null });
    mocks.draftUpdateSelect.mockResolvedValue({ data: [{ id: DRAFT_ID }], error: null });
    mocks.projectSingle.mockResolvedValue({ data: { id: PROJECT_ID }, error: null });
    mocks.fileInsert.mockResolvedValue({ error: null });
    mocks.upload.mockResolvedValue({ error: null });
    mocks.getUser.mockResolvedValue({ data: { user: oldUser() } });
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('redirects a logged-out visitor to the /import/start landing and keeps the cookie', async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null } });

    const res = await GET(makeRequest(`/import?draft=${DRAFT_ID}`));

    expect(res.headers.get('location')).toBe(
      `https://app.useoctree.com/import/start?draft=${DRAFT_ID}`
    );
    expect(res.headers.get('set-cookie')).toBeNull();
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it('keeps utm_* params on the way to the logged-out landing', async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null } });

    const res = await GET(
      makeRequest(`/import?draft=${DRAFT_ID}&utm_source=tools&utm_medium=draft&utm_campaign=templates&x=1`)
    );

    expect(res.headers.get('location')).toBe(
      `https://app.useoctree.com/import/start?draft=${DRAFT_ID}&utm_source=tools&utm_medium=draft&utm_campaign=templates`
    );
  });

  it('keeps utm_* params on the redirect into the new project', async () => {
    const res = await GET(makeRequest(`/import?draft=${DRAFT_ID}&utm_source=tools&utm_campaign=templates`));

    expect(res.headers.get('location')).toBe(
      `https://app.useoctree.com/projects/${PROJECT_ID}?welcome=1&utm_source=tools&utm_campaign=templates`
    );
  });

  it('prefers the draft id from the query over the cookie', async () => {
    await GET(makeRequest(`/import?draft=${DRAFT_ID}`, `octree_pending_draft=${COOKIE_DRAFT_ID}`));

    expect(mocks.draftSelectEq).toHaveBeenCalledWith('id', DRAFT_ID);
  });

  it('falls back to the pending-draft cookie when the query has no draft', async () => {
    mocks.draftMaybeSingle.mockResolvedValue({ data: draftRow({ id: COOKIE_DRAFT_ID }), error: null });

    const res = await GET(makeRequest('/import', `octree_pending_draft=${COOKIE_DRAFT_ID}`));

    expect(mocks.draftSelectEq).toHaveBeenCalledWith('id', COOKIE_DRAFT_ID);
    expect(res.headers.get('location')).toBe(
      `https://app.useoctree.com/projects/${PROJECT_ID}?welcome=1`
    );
  });

  it('ignores a cookie that is not a uuid and goes home with the cookie cleared', async () => {
    const res = await GET(makeRequest('/import', 'octree_pending_draft=not-a-uuid'));

    expect(res.headers.get('location')).toBe('https://app.useoctree.com/');
    expect(res.headers.get('set-cookie')).toMatch(/octree_pending_draft=;.*Max-Age=0/i);
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it('creates the project, marks the draft consumed (no delete) and lands in the editor with welcome=1', async () => {
    const before = Date.now();
    const res = await GET(makeRequest(`/import?draft=${DRAFT_ID}`, `octree_pending_draft=${DRAFT_ID}`));

    expect(mocks.projectInsert).toHaveBeenCalledWith({ title: 'My doc', user_id: 'user-1' });
    expect(mocks.upload).toHaveBeenCalledTimes(1);
    expect(mocks.fileInsert).toHaveBeenCalledWith(
      expect.objectContaining({ project_id: PROJECT_ID, name: 'main.tex' })
    );

    expect(mocks.draftUpdate).toHaveBeenCalledTimes(1);
    const update = (mocks.draftUpdate.mock.calls[0] as unknown[])[0] as Record<string, unknown>;
    expect(update).toMatchObject({ consumed_by: 'user-1', project_id: PROJECT_ID });
    expect(Date.parse(update.consumed_at as string)).toBeGreaterThanOrEqual(before - 1000);
    expect(mocks.draftUpdateEq).toHaveBeenCalledWith('id', DRAFT_ID);
    expect(mocks.draftUpdateIs).toHaveBeenCalledWith('consumed_at', null);
    expect(mocks.from('drafts')).not.toHaveProperty('delete');

    expect(res.headers.get('location')).toBe(
      `https://app.useoctree.com/projects/${PROJECT_ID}?welcome=1`
    );
    expect(res.headers.get('set-cookie')).toMatch(/octree_pending_draft=;.*Max-Age=0/i);
  });

  it('lands in the project regardless of onboarding state (never /onboarding)', async () => {
    const res = await GET(makeRequest(`/import?draft=${DRAFT_ID}`));

    expect(res.headers.get('location')).not.toContain('/onboarding');
    expect(mocks.from).not.toHaveBeenCalledWith('user_usage');
  });

  it('sends the project owner back to their project when the draft was already consumed', async () => {
    mocks.draftMaybeSingle.mockResolvedValue({
      data: draftRow({ consumed_at: '2026-10-18T00:00:00Z', consumed_by: 'user-1', project_id: 'existing' }),
      error: null,
    });

    const res = await GET(makeRequest(`/import?draft=${DRAFT_ID}`));

    expect(res.headers.get('location')).toBe('https://app.useoctree.com/projects/existing');
    expect(mocks.projectInsert).not.toHaveBeenCalled();
    expect(res.headers.get('set-cookie')).toMatch(/Max-Age=0/i);
  });

  it('goes home with the cookie cleared when the draft does not exist', async () => {
    mocks.draftMaybeSingle.mockResolvedValue({ data: null, error: null });

    const res = await GET(makeRequest(`/import?draft=${DRAFT_ID}`));

    expect(res.headers.get('location')).toBe('https://app.useoctree.com/');
    expect(res.headers.get('set-cookie')).toMatch(/Max-Age=0/i);
  });

  it('still lands in the project when the consumption update fails', async () => {
    mocks.draftUpdateSelect.mockResolvedValue({ data: null, error: { message: 'no policy' } });

    const res = await GET(makeRequest(`/import?draft=${DRAFT_ID}`));

    expect(res.headers.get('location')).toBe(
      `https://app.useoctree.com/projects/${PROJECT_ID}?welcome=1`
    );
  });

  it('still lands in the project when the update touches 0 rows but the draft is unconsumed (migration missing)', async () => {
    mocks.draftUpdateSelect.mockResolvedValue({ data: [], error: null });

    const res = await GET(makeRequest(`/import?draft=${DRAFT_ID}`));

    expect(mocks.projectDeleteEq).not.toHaveBeenCalled();
    expect(res.headers.get('location')).toBe(
      `https://app.useoctree.com/projects/${PROJECT_ID}?welcome=1`
    );
  });

  it('drops the duplicate project and lands on the first one when a concurrent request won the claim', async () => {
    mocks.draftUpdateSelect.mockResolvedValue({ data: [], error: null });
    mocks.draftMaybeSingle
      .mockResolvedValueOnce({ data: draftRow(), error: null })
      .mockResolvedValueOnce({
        data: { consumed_at: '2026-10-18T00:00:00Z', consumed_by: 'user-1', project_id: 'first' },
        error: null,
      });

    const res = await GET(makeRequest(`/import?draft=${DRAFT_ID}`));

    expect(mocks.projectDeleteEq).toHaveBeenCalledWith('id', PROJECT_ID);
    expect(mocks.remove).toHaveBeenCalledWith([`projects/${PROJECT_ID}/main.tex`]);
    expect(res.headers.get('location')).toBe('https://app.useoctree.com/projects/first?welcome=1');
    expect(res.headers.get('set-cookie')).toMatch(/Max-Age=0/i);
  });

  it('goes home when a concurrent request from another user won the claim', async () => {
    mocks.draftUpdateSelect.mockResolvedValue({ data: [], error: null });
    mocks.draftMaybeSingle
      .mockResolvedValueOnce({ data: draftRow(), error: null })
      .mockResolvedValueOnce({
        data: { consumed_at: '2026-10-18T00:00:00Z', consumed_by: 'user-2', project_id: 'theirs' },
        error: null,
      });

    const res = await GET(makeRequest(`/import?draft=${DRAFT_ID}`));

    expect(mocks.projectDeleteEq).toHaveBeenCalledWith('id', PROJECT_ID);
    expect(res.headers.get('location')).toBe('https://app.useoctree.com/');
  });

  describe('Reddit SignUp', () => {
    it('fires once for an OAuth user created in the last 10 minutes', async () => {
      mocks.getUser.mockResolvedValue({ data: { user: freshUser() } });

      await GET(makeRequest(`/import?draft=${DRAFT_ID}`));

      expect(mocks.trackRedditConversion).toHaveBeenCalledTimes(1);
      expect(mocks.trackRedditConversion.mock.calls[0][0]).toMatchObject({
        eventName: 'SignUp',
        conversionId: 'signup-user-1',
        email: 'new@example.com',
        externalId: 'user-1',
      });
    });

    it('does not fire for an existing user', async () => {
      mocks.getUser.mockResolvedValue({ data: { user: oldUser() } });

      await GET(makeRequest(`/import?draft=${DRAFT_ID}`));

      expect(mocks.trackRedditConversion).not.toHaveBeenCalled();
    });

    it('does not fire for a fresh email sign-up (signup-form already fired the pixel)', async () => {
      mocks.getUser.mockResolvedValue({ data: { user: freshEmailUser() } });

      await GET(makeRequest(`/import?draft=${DRAFT_ID}`));

      expect(mocks.trackRedditConversion).not.toHaveBeenCalled();
    });

    it('does not block the redirect when Reddit throws', async () => {
      mocks.getUser.mockResolvedValue({ data: { user: freshUser() } });
      mocks.trackRedditConversion.mockRejectedValue(new Error('reddit down'));

      const res = await GET(makeRequest(`/import?draft=${DRAFT_ID}`));

      expect(res.headers.get('location')).toBe(
        `https://app.useoctree.com/projects/${PROJECT_ID}?welcome=1`
      );
    });
  });
});
