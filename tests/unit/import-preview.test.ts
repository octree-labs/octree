import { describe, it, expect, vi } from 'vitest';
import { createHmac } from 'crypto';
// jsdom's Blob has no arrayBuffer()/text(); supabase-js returns Node's Blob on the server.
import { Blob as NodeBlob } from 'buffer';
import {
  PREVIEW_MAX_AGE_MS,
  compileErrorSummary,
  compileForPreview,
  compileServiceToken,
  loadPreviewDraft,
  mintCompileServiceToken,
  renderImportPreview,
  wrapForPreview,
} from '@/lib/import/preview';

/**
 * lib/import/preview.ts compiles an "Open in Octree" draft for the
 * logged-out landing. Supabase (admin client) and the compile service are
 * mocked; the tests pin which drafts are refused, the fragment wrapping,
 * the error mapping, the credential, and the one-compile-per-draft cache.
 */

const DRAFT_ID = '11111111-2222-4333-8444-555555555555';
const NOW = Date.parse('2026-10-18T12:00:00Z');
const PDF = Buffer.from('%PDF-1.5\n%fake\n');

function draftRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: DRAFT_ID,
    title: 'Doc',
    content: '\\documentclass{article}\\begin{document}Hi\\end{document}',
    source: 'tools:templates:x',
    consumed_at: null,
    created_at: new Date(NOW - 60_000).toISOString(),
    ...overrides,
  };
}

interface FakeAdminOptions {
  draft?: Record<string, unknown> | null;
  /** Objects already in the bucket, keyed by path. */
  objects?: Record<string, Buffer | string>;
}

function fakeAdmin({ draft = draftRow(), objects = {} }: FakeAdminOptions = {}) {
  const store = new Map<string, Buffer>(
    Object.entries(objects).map(([k, v]) => [k, Buffer.isBuffer(v) ? v : Buffer.from(v)])
  );
  const maybeSingle = vi.fn().mockResolvedValue({ data: draft, error: null });
  const eq = vi.fn(() => ({ maybeSingle }));
  const select = vi.fn(() => ({ eq }));
  const from = vi.fn(() => ({ select }));

  const download = vi.fn(async (path: string) => {
    const bytes = store.get(path);
    if (!bytes) return { data: null, error: { message: 'Object not found' } };
    return { data: new NodeBlob([new Uint8Array(bytes)]), error: null };
  });
  const upload = vi.fn(async (path: string, body: Buffer | string) => {
    store.set(path, Buffer.isBuffer(body) ? body : Buffer.from(body));
    return { data: { path }, error: null };
  });
  const storageFrom = vi.fn(() => ({ download, upload }));

  return {
    client: { from, storage: { from: storageFrom } } as any,
    mocks: { from, eq, maybeSingle, download, upload, storageFrom },
    store,
  };
}

function fakeCompile(
  responder: (init: RequestInit) => Response | Promise<Response>
): typeof fetch & { calls: Array<{ url: string; init: RequestInit }> } {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const impl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return responder(init ?? {});
  }) as any;
  impl.calls = calls;
  return impl;
}

const pdfResponse = () =>
  new Response(new Uint8Array(PDF), { status: 200, headers: { 'content-type': 'application/pdf' } });

const ENV = { COMPILE_SERVICE_URL: 'https://compile.example', SUPABASE_SERVICE_ROLE_KEY: 'eyJ.service.key' };

describe('wrapForPreview', () => {
  it('leaves a full document untouched', () => {
    const doc = '\\documentclass{article}\n\\begin{document}\nHi\n\\end{document}';
    expect(wrapForPreview(doc)).toBe(doc);
  });

  it('wraps a fragment in article + amsmath/amssymb', () => {
    const out = wrapForPreview('Hello $x^2$');
    expect(out.startsWith('\\documentclass{article}\n\\usepackage{amsmath}\n\\usepackage{amssymb}\n')).toBe(true);
    expect(out).toContain('\\begin{document}\n\nHello $x^2$\n\n\\end{document}');
  });

  it('strips code fences and hoists \\usepackage lines into the preamble', () => {
    const out = wrapForPreview('```latex\n\\usepackage{siunitx}\n\\SI{1}{m}\n```');
    const preamble = out.slice(0, out.indexOf('\\begin{document}'));
    expect(preamble).toContain('\\usepackage{siunitx}');
    expect(out.slice(out.indexOf('\\begin{document}'))).not.toContain('\\usepackage');
    expect(out).not.toContain('```');
  });

  it('adds the packages the fragment needs (tikz, booktabs) once', () => {
    const out = wrapForPreview('\\begin{tikzpicture}\\draw (0,0)--(1,1);\\end{tikzpicture}\n\\toprule');
    expect(out).toContain('\\usepackage{tikz}');
    expect(out).toContain('\\usepackage{booktabs}');
    expect(out.match(/\\usepackage\{tikz\}/g)).toHaveLength(1);
  });

  it('prefers pgfplots over tikz when both are detected', () => {
    const out = wrapForPreview('\\begin{tikzpicture}\\begin{axis}\\addplot{x};\\end{axis}\\end{tikzpicture}');
    expect(out).toContain('\\usepackage{pgfplots}');
    expect(out).toContain('\\pgfplotsset{compat=1.18}');
    expect(out).not.toContain('\\usepackage{tikz}');
  });
});

describe('compileErrorSummary', () => {
  it('keeps the first `!` error lines (and their l.N line) from the log', () => {
    const log = [
      'This is pdfTeX, Version 3.14',
      '(/tmp/latex-abc123/main.tex',
      '! Undefined control sequence.',
      'l.4 \\foo',
      '! Missing $ inserted.',
      'l.9 x^2',
      '! Emergency stop.',
      'No pages of output.',
    ].join('\n');
    expect(compileErrorSummary({ log })).toEqual([
      '! Undefined control sequence.',
      'l.4 \\foo',
      '! Missing $ inserted.',
    ]);
  });

  it('falls back to the service message when the log has no error marker', () => {
    expect(compileErrorSummary({ log: 'nothing useful', message: 'latexmk exited with 12' })).toEqual([
      'latexmk exited with 12',
    ]);
    expect(compileErrorSummary({})).toEqual([]);
  });

  it('strips the compile service temp directory from paths', () => {
    expect(compileErrorSummary({ log: '/tmp/latex-xyz/main.tex:3: Undefined control sequence.' })).toEqual([
      './main.tex:3: Undefined control sequence.',
    ]);
  });
});

describe('compileServiceToken', () => {
  it('mints a short-lived HS256 token when SUPABASE_JWT_SECRET is set', () => {
    const token = compileServiceToken({ SUPABASE_JWT_SECRET: 'shh', SUPABASE_SERVICE_ROLE_KEY: 'eyJ.x' }, NOW);
    expect(token).toBe(mintCompileServiceToken('shh', NOW));

    const [header, payload, signature] = token!.split('.');
    expect(JSON.parse(Buffer.from(header, 'base64url').toString())).toEqual({ alg: 'HS256', typ: 'JWT' });
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString());
    expect(claims.iss).toBe('octree-app');
    expect(claims.sub).toBe('import-preview');
    expect(claims.exp - claims.iat).toBe(120);
    expect(claims.iat).toBe(Math.floor(NOW / 1000));
    const expected = createHmac('sha256', 'shh').update(`${header}.${payload}`).digest('base64url');
    expect(signature).toBe(expected);
  });

  it('falls back to the service-role key only when it is a JWT, and never to nothing', () => {
    expect(compileServiceToken({ SUPABASE_SERVICE_ROLE_KEY: 'eyJhbGciOi.payload.sig' })).toBe('eyJhbGciOi.payload.sig');
    expect(compileServiceToken({ SUPABASE_SERVICE_ROLE_KEY: 'sb_secret_newformat' })).toBeNull();
    expect(compileServiceToken({})).toBeNull();
  });
});

describe('loadPreviewDraft', () => {
  it('returns the draft when it is unconsumed and recent', async () => {
    const { client } = fakeAdmin();
    const result = await loadPreviewDraft(client, DRAFT_ID, NOW);
    expect(result).toEqual({ ok: true, draft: draftRow() });
  });

  it('refuses consumed drafts', async () => {
    const { client } = fakeAdmin({ draft: draftRow({ consumed_at: new Date(NOW).toISOString() }) });
    expect(await loadPreviewDraft(client, DRAFT_ID, NOW)).toEqual({ ok: false, reason: 'consumed' });
  });

  it('refuses drafts older than the 7-day window', async () => {
    const { client } = fakeAdmin({
      draft: draftRow({ created_at: new Date(NOW - PREVIEW_MAX_AGE_MS - 1000).toISOString() }),
    });
    expect(await loadPreviewDraft(client, DRAFT_ID, NOW)).toEqual({ ok: false, reason: 'expired' });
  });

  it('refuses unknown drafts and malformed ids without querying', async () => {
    const { client, mocks } = fakeAdmin({ draft: null });
    expect(await loadPreviewDraft(client, DRAFT_ID, NOW)).toEqual({ ok: false, reason: 'not_found' });
    expect(await loadPreviewDraft(client, 'not-a-uuid', NOW)).toEqual({ ok: false, reason: 'not_found' });
    expect(mocks.maybeSingle).toHaveBeenCalledTimes(1);
  });
});

describe('compileForPreview', () => {
  it('posts main.tex with the bearer token and returns the PDF bytes', async () => {
    const fetchImpl = fakeCompile(pdfResponse);
    const outcome = await compileForPreview('\\documentclass{article}', {
      compileServiceUrl: 'https://compile.example/',
      token: 'tok',
      fetchImpl,
      projectId: 'p1',
    });

    expect(outcome).toEqual({ ok: true, pdf: PDF });
    expect(fetchImpl.calls[0].url).toBe('https://compile.example/compile');
    const headers = fetchImpl.calls[0].init.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer tok');
    expect(JSON.parse(String(fetchImpl.calls[0].init.body))).toEqual({
      files: [{ path: 'main.tex', content: '\\documentclass{article}' }],
      projectId: 'p1',
      lastModifiedFile: 'main.tex',
    });
  });

  it('maps a 500 to compile_failed with the first error lines', async () => {
    const fetchImpl = fakeCompile(
      () =>
        new Response(
          JSON.stringify({ error: 'LaTeX compilation failed', log: 'x\n! Undefined control sequence.\nl.2 \\nope\n' }),
          { status: 500 }
        )
    );
    const outcome = await compileForPreview('x', { compileServiceUrl: 'https://c', token: 't', fetchImpl });
    expect(outcome).toEqual({
      ok: false,
      reason: 'compile_failed',
      errorLines: ['! Undefined control sequence.', 'l.2 \\nope'],
    });
  });

  it('treats 401/503 and non-PDF bodies as the service being unavailable', async () => {
    const unauthorized = fakeCompile(() => new Response(JSON.stringify({ error: 'Invalid or expired token' }), { status: 401 }));
    expect(await compileForPreview('x', { compileServiceUrl: 'https://c', token: 't', fetchImpl: unauthorized })).toMatchObject({
      ok: false,
      reason: 'unavailable',
    });

    const html = fakeCompile(() => new Response('<html>', { status: 200 }));
    expect(await compileForPreview('x', { compileServiceUrl: 'https://c', token: 't', fetchImpl: html })).toMatchObject({
      ok: false,
      reason: 'unavailable',
    });
  });

  it('aborts after the timeout', async () => {
    const fetchImpl = vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            const error = new Error('aborted');
            error.name = 'AbortError';
            reject(error);
          });
        })
    ) as any;
    const outcome = await compileForPreview('x', { compileServiceUrl: 'https://c', token: 't', fetchImpl, timeoutMs: 5 });
    expect(outcome).toMatchObject({ ok: false, reason: 'unavailable' });
    expect((outcome as any).detail).toContain('timed out');
  });
});

describe('renderImportPreview', () => {
  it('compiles once and stores the PDF under <draftId>.pdf', async () => {
    const { client, mocks, store } = fakeAdmin();
    const fetchImpl = fakeCompile(pdfResponse);

    const result = await renderImportPreview(DRAFT_ID, { admin: client, fetchImpl, env: ENV, now: NOW });

    expect(result).toEqual({ ok: true, pdf: PDF, cached: false, title: 'Doc', source: 'tools:templates:x' });
    expect(fetchImpl.calls).toHaveLength(1);
    expect(mocks.storageFrom).toHaveBeenCalledWith('import-previews');
    expect(store.get(`${DRAFT_ID}.pdf`)).toEqual(PDF);
    const headers = fetchImpl.calls[0].init.headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Bearer ${ENV.SUPABASE_SERVICE_ROLE_KEY}`);
  });

  it('serves a stored PDF without calling the compile service', async () => {
    const { client } = fakeAdmin({ objects: { [`${DRAFT_ID}.pdf`]: PDF } });
    const fetchImpl = fakeCompile(pdfResponse);

    const result = await renderImportPreview(DRAFT_ID, { admin: client, fetchImpl, env: ENV, now: NOW });

    expect(result).toMatchObject({ ok: true, cached: true });
    expect(fetchImpl.calls).toHaveLength(0);
  });

  it('remembers a compile failure so the draft is never compiled twice', async () => {
    const { client, store } = fakeAdmin();
    const fetchImpl = fakeCompile(
      () => new Response(JSON.stringify({ error: 'LaTeX compilation failed', log: '! Boom.\n' }), { status: 500 })
    );

    const first = await renderImportPreview(DRAFT_ID, { admin: client, fetchImpl, env: ENV, now: NOW });
    expect(first).toEqual({ ok: false, reason: 'compile_failed', errorLines: ['! Boom.'], cached: false });
    expect(JSON.parse(store.get(`${DRAFT_ID}.error.json`)!.toString())).toEqual({ errorLines: ['! Boom.'] });

    const second = await renderImportPreview(DRAFT_ID, { admin: client, fetchImpl, env: ENV, now: NOW });
    expect(second).toEqual({ ok: false, reason: 'compile_failed', errorLines: ['! Boom.'], cached: true });
    expect(fetchImpl.calls).toHaveLength(1);
  });

  it('does not cache an unavailable service, so the next visit retries', async () => {
    const { client, store } = fakeAdmin();
    const fetchImpl = fakeCompile(() => new Response(JSON.stringify({ error: 'Server busy' }), { status: 503 }));

    const result = await renderImportPreview(DRAFT_ID, { admin: client, fetchImpl, env: ENV, now: NOW });

    expect(result).toEqual({ ok: false, reason: 'unavailable' });
    expect(store.size).toBe(0);
  });

  it('refuses consumed drafts even when a PDF was stored earlier', async () => {
    const { client } = fakeAdmin({
      draft: draftRow({ consumed_at: new Date(NOW).toISOString() }),
      objects: { [`${DRAFT_ID}.pdf`]: PDF },
    });
    const fetchImpl = fakeCompile(pdfResponse);

    const result = await renderImportPreview(DRAFT_ID, { admin: client, fetchImpl, env: ENV, now: NOW });

    expect(result).toEqual({ ok: false, reason: 'consumed' });
    expect(fetchImpl.calls).toHaveLength(0);
  });

  it('is unavailable without COMPILE_SERVICE_URL or a compile credential', async () => {
    const { client } = fakeAdmin();
    const fetchImpl = fakeCompile(pdfResponse);

    expect(
      await renderImportPreview(DRAFT_ID, { admin: client, fetchImpl, env: { COMPILE_SERVICE_URL: 'https://c' }, now: NOW })
    ).toEqual({ ok: false, reason: 'unavailable' });
    expect(
      await renderImportPreview(DRAFT_ID, { admin: client, fetchImpl, env: { SUPABASE_SERVICE_ROLE_KEY: 'eyJ.k' }, now: NOW })
    ).toEqual({ ok: false, reason: 'unavailable' });
    expect(fetchImpl.calls).toHaveLength(0);
  });

  it('wraps a fragment before sending it to the compile service', async () => {
    const { client } = fakeAdmin({ draft: draftRow({ content: 'Just $x^2$' }) });
    const fetchImpl = fakeCompile(pdfResponse);

    await renderImportPreview(DRAFT_ID, { admin: client, fetchImpl, env: ENV, now: NOW });

    const sent = JSON.parse(String(fetchImpl.calls[0].init.body)).files[0].content as string;
    expect(sent).toContain('\\documentclass{article}');
    expect(sent).toContain('Just $x^2$');
  });

  it('shares one compile between concurrent requests for the same draft', async () => {
    const { client } = fakeAdmin();
    const fetchImpl = fakeCompile(pdfResponse);

    const [a, b] = await Promise.all([
      renderImportPreview(DRAFT_ID, { admin: client, fetchImpl, env: ENV, now: NOW }),
      renderImportPreview(DRAFT_ID, { admin: client, fetchImpl, env: ENV, now: NOW }),
    ]);

    expect(a).toMatchObject({ ok: true });
    expect(b).toMatchObject({ ok: true });
    expect(fetchImpl.calls).toHaveLength(1);
  });
});
