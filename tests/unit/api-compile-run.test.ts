// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * lib/api/compile.ts runApiCompile: credential and quota before the compile,
 * the compile service answer mapped to the API's outcomes, analytics with
 * sizes and kinds only. The compile call, Supabase and PostHog are mocked.
 */

const mocks = vi.hoisted(() => ({
  compileLatex: vi.fn(),
  rpc: vi.fn(),
  capture: vi.fn(),
  upload: vi.fn(),
  createSignedUrl: vi.fn(),
  from: vi.fn(),
}));

vi.mock('@/app/api/compile-pdf/compiler', () => ({ compileLatex: mocks.compileLatex }));
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({ rpc: mocks.rpc, storage: { from: mocks.from } }),
}));
vi.mock('@/lib/posthog-server', () => ({ captureServerEventAfterResponse: mocks.capture }));
vi.mock('@/lib/api/compile-result', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api/compile-result')>()),
  countPdfPages: vi.fn(async () => 4),
}));

import { runApiCompile } from '@/lib/api/compile';
import type { ApiCompileRequest } from '@/lib/api/compile-request';

const DOC = '\\documentclass{article}\\begin{document}Hi\\end{document}';
const REQUEST: ApiCompileRequest = { files: [{ path: 'main.tex', content: DOC }], main: 'main.tex', response: 'json', sourceBytes: DOC.length };
const FREE = { userId: 'user-1', keyId: 'key-1', plan: 'free' as const };
const PDF = Buffer.from('%PDF-1.5 fake');

const ENV = { ...process.env };

describe('runApiCompile', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.COMPILE_SERVICE_URL = 'https://compile.example.test/';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'eyJservice.role.key';
    delete process.env.SUPABASE_JWT_SECRET;
    mocks.rpc.mockResolvedValue({ data: 1, error: null });
    mocks.from.mockReturnValue({ upload: mocks.upload, createSignedUrl: mocks.createSignedUrl });
    mocks.upload.mockResolvedValue({ data: { path: 'p' }, error: null });
    mocks.createSignedUrl.mockResolvedValue({ data: { signedUrl: 'https://sb.example/sign/x.pdf?token=t' }, error: null });
  });
  afterEach(() => {
    process.env = { ...ENV };
  });

  it('is 503 compile_unavailable without a credential, before counting quota', async () => {
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    const outcome = await runApiCompile(FREE, REQUEST, 'rest');
    expect(outcome).toMatchObject({ kind: 'error', status: 503, body: { error: 'compile_unavailable' } });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('is 503 compile_unavailable without COMPILE_SERVICE_URL', async () => {
    delete process.env.COMPILE_SERVICE_URL;
    expect(await runApiCompile(FREE, REQUEST, 'rest')).toMatchObject({ status: 503, body: { error: 'compile_unavailable' } });
  });

  it('compiles with the service-role credential, no project id, and counts one compile', async () => {
    mocks.compileLatex.mockResolvedValue({ success: true, pdfBuffer: PDF, base64PDF: PDF.toString('base64') });
    const outcome = await runApiCompile(FREE, REQUEST, 'rest');
    expect(mocks.rpc).toHaveBeenCalledWith('increment_api_usage', { p_user_id: 'user-1', p_day: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) });
    expect(mocks.compileLatex).toHaveBeenCalledWith(
      { files: REQUEST.files, lastModifiedFile: 'main.tex' },
      'https://compile.example.test',
      'eyJservice.role.key',
      100_000
    );
    expect(outcome).toMatchObject({
      kind: 'result',
      json: {
        ok: true,
        pages: 4,
        pdf_base64: PDF.toString('base64'),
        quota: { counter: 'compiles', limit: 30, used: 1, remaining: 29, resets_at: expect.any(String) },
      },
    });
    // No storePdf: nothing uploaded, no pdf_url field.
    expect(mocks.upload).not.toHaveBeenCalled();
    expect(outcome.kind === 'result' && 'pdf_url' in outcome.json).toBe(false);
    expect(mocks.capture).toHaveBeenCalledWith('user-1', 'api_compile', {
      ok: true,
      via: 'rest',
      mode: 'compile',
      duration_ms: expect.any(Number),
      source_bytes: DOC.length,
      plan: 'free',
    });
  });

  it('refuses over quota with 429 and never compiles', async () => {
    mocks.rpc.mockResolvedValue({ data: 31, error: null });
    const outcome = await runApiCompile(FREE, REQUEST, 'mcp');
    expect(outcome).toMatchObject({
      kind: 'error',
      status: 429,
      body: {
        error: 'quota_exceeded',
        counter: 'compiles',
        limit: 30,
        used: 30,
        resets_at: expect.stringMatching(/T00:00:00\.000Z$/),
        upgrade_url: 'https://app.useoctree.com/pricing?from=api',
      },
      headers: { 'Retry-After': expect.any(String) },
    });
    expect(mocks.compileLatex).not.toHaveBeenCalled();
    expect(mocks.capture).toHaveBeenCalledWith('user-1', 'api_quota_exceeded', {
      via: 'mcp',
      limit: 30,
      plan: 'free',
      counter: 'compiles',
    });
  });

  it('storePdf uploads the PDF to the private bucket and returns a signed pdf_url', async () => {
    mocks.compileLatex.mockResolvedValue({ success: true, pdfBuffer: PDF, base64PDF: PDF.toString('base64'), engine: 'lualatex' });
    const outcome = await runApiCompile(FREE, REQUEST, 'mcp', { storePdf: true });
    expect(mocks.from).toHaveBeenCalledWith('api-artifacts');
    const [path, body, options] = mocks.upload.mock.calls[0];
    expect(path).toMatch(/^\d{4}-\d{2}-\d{2}\/user-1\/[0-9a-f-]{36}\.pdf$/);
    expect(body).toBe(PDF);
    expect(options).toMatchObject({ contentType: 'application/pdf', upsert: false });
    expect(mocks.createSignedUrl).toHaveBeenCalledWith(path, 3600);
    expect(outcome).toMatchObject({
      kind: 'result',
      json: { ok: true, engine: 'lualatex', pdf_url: 'https://sb.example/sign/x.pdf?token=t', pdf_url_expires_at: expect.any(String) },
    });
    expect(mocks.capture.mock.calls[0][2]).toMatchObject({ ok: true, pdf_url: true });
  });

  it('answers with pdf_url null (and the inline PDF) when storage fails', async () => {
    mocks.compileLatex.mockResolvedValue({ success: true, pdfBuffer: PDF, base64PDF: PDF.toString('base64') });
    mocks.upload.mockResolvedValue({ data: null, error: { message: 'Bucket not found' } });
    const outcome = await runApiCompile(FREE, REQUEST, 'rest', { storePdf: true });
    expect(outcome).toMatchObject({ kind: 'result', json: { ok: true, pdf_url: null, pdf_base64: PDF.toString('base64') } });
    expect(mocks.capture.mock.calls[0][2]).toMatchObject({ pdf_url: false });
  });

  it('check mode counts on the checks counter, skips pages and never stores a PDF', async () => {
    mocks.rpc.mockResolvedValue({ data: 31, error: null });
    mocks.compileLatex.mockResolvedValue({ success: true, pdfBuffer: PDF, base64PDF: PDF.toString('base64') });
    const outcome = await runApiCompile(FREE, REQUEST, 'mcp', { mode: 'check', storePdf: true });
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    expect(mocks.rpc).toHaveBeenCalledWith('increment_api_check_usage', expect.objectContaining({ p_user_id: 'user-1' }));
    // 31 checks is over the compile limit (30) but well inside the check limit.
    expect(outcome).toMatchObject({ kind: 'result', json: { ok: true, quota: { counter: 'checks', limit: 200, used: 31, remaining: 169 } } });
    expect(outcome.kind === 'result' && outcome.json.ok && outcome.json.pages).toBeFalsy();
    expect(mocks.upload).not.toHaveBeenCalled();
    expect(mocks.capture.mock.calls[0][2]).toMatchObject({ mode: 'check' });
  });

  it('check mode has its own cap', async () => {
    mocks.rpc.mockResolvedValue({ data: 201, error: null });
    const outcome = await runApiCompile(FREE, REQUEST, 'mcp', { mode: 'check' });
    expect(outcome).toMatchObject({ kind: 'error', status: 429, body: { counter: 'checks', limit: 200, error: 'quota_exceeded' } });
    expect(mocks.compileLatex).not.toHaveBeenCalled();
  });

  it('check mode falls back to the compile counter while the checks migration is missing', async () => {
    mocks.rpc
      .mockResolvedValueOnce({ data: null, error: { code: 'PGRST202', message: 'Could not find the function public.increment_api_check_usage' } })
      .mockResolvedValueOnce({ data: 5, error: null });
    mocks.compileLatex.mockResolvedValue({ success: true, pdfBuffer: PDF, base64PDF: PDF.toString('base64') });
    const outcome = await runApiCompile(FREE, REQUEST, 'mcp', { mode: 'check' });
    expect(mocks.rpc.mock.calls.map((c) => c[0])).toEqual(['increment_api_check_usage', 'increment_api_usage']);
    expect(outcome).toMatchObject({ json: { quota: { counter: 'compiles', used: 5, limit: 30 } } });
  });

  it('check mode is 503 on other accounting errors (no silent fallback)', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: '57014', message: 'canceling statement due to statement timeout' } });
    expect(await runApiCompile(FREE, REQUEST, 'mcp', { mode: 'check' })).toMatchObject({ status: 503 });
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
  });

  it('is 503 when usage cannot be counted (migration missing)', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'function does not exist' } });
    expect(await runApiCompile(FREE, REQUEST, 'rest')).toMatchObject({ status: 503 });
    expect(mocks.compileLatex).not.toHaveBeenCalled();
  });

  it('returns a LaTeX failure as a result with structured errors', async () => {
    mocks.compileLatex.mockResolvedValue({
      success: false,
      error: { status: 500, error: 'LaTeX compilation failed', details: 'x', log: './main.tex:3: Undefined control sequence.\nl.3 \\foo' },
    });
    const outcome = await runApiCompile(FREE, REQUEST, 'rest');
    expect(outcome).toMatchObject({
      kind: 'result',
      json: { ok: false, errors: [{ file: 'main.tex', line: 3, kind: 'undefined_control_sequence' }] },
    });
    const props = mocks.capture.mock.calls[0][2];
    expect(props).toMatchObject({ ok: false, error_kind: 'undefined_control_sequence' });
    // Analytics carry sizes and kinds only, never source or log text.
    expect(JSON.stringify(props)).not.toContain('documentclass');
    expect(JSON.stringify(props)).not.toContain('Undefined control sequence');
  });

  it('maps service problems to 400 / 504 / 503', async () => {
    mocks.compileLatex.mockResolvedValueOnce({ success: false, error: { status: 400, error: 'Invalid request', details: 'Invalid file path' } });
    expect(await runApiCompile(FREE, REQUEST, 'rest')).toMatchObject({ status: 400, body: { error: 'invalid_request', message: 'Invalid file path' } });
    mocks.compileLatex.mockResolvedValueOnce({ success: false, error: { timedOut: true, error: 'timed out', details: '' } });
    expect(await runApiCompile(FREE, REQUEST, 'rest')).toMatchObject({ status: 504, body: { error: 'compile_timeout' } });
    mocks.compileLatex.mockResolvedValueOnce({ success: false, error: { status: 503, error: 'Server busy', details: '' } });
    expect(await runApiCompile(FREE, REQUEST, 'rest')).toMatchObject({ status: 503, body: { error: 'compile_unavailable' } });
  });
});
