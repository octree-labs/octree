import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * app/import/start/page.tsx is the logged-out "Open in Octree" landing. The
 * draft is read by id with the service role (the public key has no access to
 * `drafts` since 20261109140000_drafts_no_public_select); the session client
 * is only used to check whether the visitor is signed in.
 */

const DRAFT_ID = '11111111-2222-4333-8444-555555555555';

const mocks = vi.hoisted(() => {
  const getUser = vi.fn();
  const maybeSingle = vi.fn();
  const eq = vi.fn(() => ({ maybeSingle }));
  const select = vi.fn(() => ({ eq }));
  const adminFrom = vi.fn(() => ({ select }));
  const sessionFrom = vi.fn(() => {
    throw new Error('drafts must not be read with the session client');
  });
  const redirect = vi.fn((to: string) => {
    throw new Error(`REDIRECT:${to}`);
  });
  const cookieGet = vi.fn();
  return { getUser, maybeSingle, eq, select, adminFrom, sessionFrom, redirect, cookieGet };
});

vi.mock('next/headers', () => ({ cookies: async () => ({ get: mocks.cookieGet }) }));
vi.mock('next/navigation', () => ({ redirect: mocks.redirect }));
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { getUser: mocks.getUser }, from: mocks.sessionFrom }),
}));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({ from: mocks.adminFrom }) }));
vi.mock('@/components/import/import-guest-landing', () => ({ ImportGuestLanding: () => null }));
vi.mock('@/components/icons/octree-logo', () => ({ OctreeLogo: () => null, OctreeWordmark: () => null }));

import ImportStartPage from '@/app/import/start/page';

function render(params: Record<string, string> = { draft: DRAFT_ID }) {
  return ImportStartPage({ searchParams: Promise.resolve(params) });
}

function findLanding(node: any): any {
  if (!node || typeof node !== 'object') return null;
  if (node.props?.draftId) return node;
  const children = node.props?.children;
  for (const child of Array.isArray(children) ? children : [children]) {
    const found = findLanding(child);
    if (found) return found;
  }
  return null;
}

describe('/import/start', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getUser.mockResolvedValue({ data: { user: null } });
    mocks.cookieGet.mockReturnValue(undefined);
    mocks.maybeSingle.mockResolvedValue({
      data: {
        id: DRAFT_ID,
        title: 'My doc',
        content: '\\documentclass{article}\n\\begin{document}hi\\end{document}',
        source: 'tools:templates',
        consumed_at: null,
      },
      error: null,
    });
  });

  it('reads exactly one draft by id with the service role and renders the guest landing', async () => {
    const page = await render();

    expect(mocks.adminFrom).toHaveBeenCalledWith('drafts');
    expect(mocks.eq).toHaveBeenCalledWith('id', DRAFT_ID);
    expect(mocks.sessionFrom).not.toHaveBeenCalled();
    const landing = findLanding(page);
    expect(landing.props).toMatchObject({ draftId: DRAFT_ID, title: 'My doc' });
  });

  it('previews a multi-file draft from its main file', async () => {
    mocks.maybeSingle.mockResolvedValue({
      data: {
        id: DRAFT_ID,
        title: 'Thesis',
        content: '\\documentclass{book}',
        source: 'tools:templates',
        consumed_at: null,
        files: [
          { path: 'main.tex', content: '\\documentclass{book}' },
          { path: 'chapters/one.tex', content: 'One' },
        ],
      },
      error: null,
    });

    const landing = findLanding(await render());

    expect(landing.props.files.map((f: { path: string }) => f.path)).toEqual(['main.tex', 'chapters/one.tex']);
    expect(landing.props.latexPreview).toBe('\\documentclass{book}');
  });

  it('falls back to the pending-draft cookie', async () => {
    mocks.cookieGet.mockReturnValue({ value: DRAFT_ID });

    await render({});

    expect(mocks.eq).toHaveBeenCalledWith('id', DRAFT_ID);
  });

  it('goes home for consumed or unknown drafts', async () => {
    mocks.maybeSingle.mockResolvedValue({ data: { id: DRAFT_ID, content: 'x', consumed_at: '2026-11-01' }, error: null });
    await expect(render()).rejects.toThrow('REDIRECT:/');

    mocks.maybeSingle.mockResolvedValue({ data: null, error: null });
    await expect(render()).rejects.toThrow('REDIRECT:/');
  });

  it('sends signed-in visitors to /import without reading the draft', async () => {
    mocks.getUser.mockResolvedValue({ data: { user: { id: 'user-1' } } });

    await expect(render()).rejects.toThrow(`REDIRECT:/import?draft=${DRAFT_ID}`);
    expect(mocks.adminFrom).not.toHaveBeenCalled();
  });
});
