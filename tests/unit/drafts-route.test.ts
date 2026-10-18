import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * app/api/drafts/route.ts receives the "Open in Octree" form POST from
 * tools.useoctree.com. These tests pin the 303 redirect, the CORS headers
 * the tools origin depends on, and the pending-draft cookie set alongside.
 */

const mocks = vi.hoisted(() => {
  const single = vi.fn();
  const select = vi.fn(() => ({ single }));
  const insert = vi.fn(() => ({ select }));
  const from = vi.fn(() => ({ insert }));
  return { single, select, insert, from };
});

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ from: mocks.from }),
}));

import { POST, OPTIONS } from '@/app/api/drafts/route';

const DRAFT_ID = '11111111-2222-4333-8444-555555555555';

function formPost(fields: Record<string, string>) {
  return new Request('https://app.useoctree.com/api/drafts', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(fields).toString(),
  }) as any;
}

describe('POST /api/drafts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.single.mockResolvedValue({ data: { id: DRAFT_ID }, error: null });
  });

  it('stores the draft, 303-redirects to /import?draft=<id> and sets the pending-draft cookie', async () => {
    const res = await POST(
      formPost({ content: '\\documentclass{article}', title: 'My doc', source: 'tools:templates' })
    );

    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe(`https://app.useoctree.com/import?draft=${DRAFT_ID}`);
    expect(mocks.from).toHaveBeenCalledWith('drafts');
    expect(mocks.insert).toHaveBeenCalledWith({
      content: '\\documentclass{article}',
      title: 'My doc',
      source: 'tools:templates',
    });

    const setCookie = res.headers.get('set-cookie') ?? '';
    expect(setCookie).toContain(`octree_pending_draft=${DRAFT_ID}`);
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/Secure/i);
    expect(setCookie).toMatch(/SameSite=lax/i);
    expect(setCookie).toMatch(/Path=\//);
    expect(setCookie).toMatch(/Max-Age=604800/);
  });

  it('keeps the CORS headers for tools.useoctree.com on the redirect response', async () => {
    const res = await POST(formPost({ content: 'x' }));

    expect(res.headers.get('access-control-allow-origin')).toBe('https://tools.useoctree.com');
    expect(res.headers.get('access-control-allow-credentials')).toBe('true');
    expect(res.headers.get('access-control-allow-methods')).toBe('GET, HEAD, POST, OPTIONS');
  });

  it('answers preflight with the same CORS headers', async () => {
    const res = await OPTIONS();

    expect(res.headers.get('access-control-allow-origin')).toBe('https://tools.useoctree.com');
    expect(res.headers.get('access-control-allow-headers')).toBe('Content-Type');
  });

  it('returns 400 without a cookie when content is missing', async () => {
    const res = await POST(formPost({ title: 'empty' }));

    expect(res.status).toBe(400);
    expect(res.headers.get('set-cookie')).toBeNull();
    expect(mocks.insert).not.toHaveBeenCalled();
  });
});
