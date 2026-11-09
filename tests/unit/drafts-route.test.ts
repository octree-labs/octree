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

let ipCounter = 0;

function formPost(
  fields: Record<string, string>,
  ip = `203.0.113.${++ipCounter}`,
  query = ''
) {
  return new Request(`https://app.useoctree.com/api/drafts${query}`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-forwarded-for': ip },
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

  it('carries the utm_* params of the form action onto the redirect and drops the rest', async () => {
    const res = await POST(
      formPost(
        { content: 'x', source: 'tools:latex-preview:fix-error' },
        undefined,
        '?utm_source=tools&utm_medium=draft&utm_campaign=latex-preview-fix-error&ref=abc&draft=evil'
      )
    );

    expect(res.status).toBe(303);
    const location = new URL(res.headers.get('location')!);
    expect(location.pathname).toBe('/import');
    expect(location.searchParams.get('draft')).toBe(DRAFT_ID);
    expect(location.searchParams.getAll('draft')).toHaveLength(1);
    expect(location.searchParams.get('utm_source')).toBe('tools');
    expect(location.searchParams.get('utm_medium')).toBe('draft');
    expect(location.searchParams.get('utm_campaign')).toBe('latex-preview-fix-error');
    expect(location.searchParams.has('ref')).toBe(false);
    // `source` stays on the draft row, never in the URL.
    expect(location.searchParams.has('source')).toBe(false);
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

  it('rejects drafts over 200k characters with 413 and stores nothing', async () => {
    const res = await POST(formPost({ content: 'x'.repeat(200_001) }));

    expect(res.status).toBe(413);
    expect(res.headers.get('access-control-allow-origin')).toBe('https://tools.useoctree.com');
    expect(mocks.insert).not.toHaveBeenCalled();
  });

  it('limits one IP to 20 drafts a minute', async () => {
    const ip = '198.51.100.9';
    for (let i = 0; i < 20; i++) {
      expect((await POST(formPost({ content: 'x' }, ip))).status).toBe(303);
    }

    const limited = await POST(formPost({ content: 'x' }, ip));

    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get('retry-after'))).toBeGreaterThan(0);
    expect(limited.headers.get('access-control-allow-origin')).toBe('https://tools.useoctree.com');
    expect(mocks.insert).toHaveBeenCalledTimes(20);
    // Another IP is unaffected.
    expect((await POST(formPost({ content: 'x' }, '198.51.100.10'))).status).toBe(303);
  });

  describe('multi-file drafts', () => {
    const DOC = '\\documentclass{article}\\begin{document}\\bibliography{refs}\\end{document}';
    const files = [
      { path: 'refs.bib', content: '@misc{a}' },
      { path: 'paper.tex', content: DOC },
    ];

    it('stores the validated files (main first) and keeps the main file in content', async () => {
      const res = await POST(
        formPost({
          content: 'flattened fallback for older apps',
          title: 'Paper',
          source: 'tools:arxiv-to-latex',
          files: JSON.stringify(files),
        })
      );

      expect(res.status).toBe(303);
      expect(mocks.insert).toHaveBeenCalledWith({
        content: DOC,
        title: 'Paper',
        source: 'tools:arxiv-to-latex',
        files: [files[1], files[0]],
      });
    });

    it('accepts files without content, honours main, and works with a JSON body', async () => {
      const req = new Request('https://app.useoctree.com/api/drafts', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-forwarded-for': '192.0.2.77' },
        body: JSON.stringify({ files: [...files, { path: 'alt.tex', content: DOC }], main: 'alt.tex' }),
      }) as any;

      const res = await POST(req);

      expect(res.status).toBe(303);
      const inserted = (mocks.insert.mock.calls[0] as unknown[])[0] as any;
      expect(inserted.files.map((f: any) => f.path)).toEqual(['alt.tex', 'refs.bib', 'paper.tex']);
    });

    it('rejects bad paths and malformed JSON with 400, and too much source with 413', async () => {
      const bad = await POST(formPost({ files: JSON.stringify([...files, { path: '../x.tex', content: 'x' }]) }));
      expect(bad.status).toBe(400);
      expect(bad.headers.get('access-control-allow-origin')).toBe('https://tools.useoctree.com');

      expect((await POST(formPost({ content: 'x', files: '{oops' }))).status).toBe(400);

      const big = 'x'.repeat(1024 * 1024 + 1);
      const tooBig = await POST(
        formPost({
          files: JSON.stringify([
            { path: 'main.tex', content: DOC },
            { path: 'a.tex', content: big },
            { path: 'b.tex', content: big },
          ]),
        })
      );
      expect(tooBig.status).toBe(413);
      expect(mocks.insert).not.toHaveBeenCalled();
    });

    it('treats an empty files field as a single-file draft', async () => {
      const res = await POST(formPost({ content: 'x', files: '' }));

      expect(res.status).toBe(303);
      expect(mocks.insert).toHaveBeenCalledWith({ content: 'x', title: 'Imported from Tools', source: null });
    });

    it('falls back to the main file when the files column does not exist yet', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      mocks.single
        .mockResolvedValueOnce({ data: null, error: { code: 'PGRST204', message: "Could not find the 'files' column" } })
        .mockResolvedValueOnce({ data: { id: DRAFT_ID }, error: null });

      const res = await POST(formPost({ files: JSON.stringify(files) }));

      expect(res.status).toBe(303);
      expect(mocks.insert).toHaveBeenCalledTimes(2);
      expect(mocks.insert).toHaveBeenLastCalledWith({ content: DOC, title: 'Imported from Tools', source: null });
    });
  });
});
