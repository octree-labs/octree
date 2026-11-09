// @vitest-environment node
import { describe, it, expect, beforeEach, vi } from 'vitest';

/** app/api/v1/compile and app/api/mcp: auth gate, validation, response formats, CORS. */

const mocks = vi.hoisted(() => ({
  authenticate: vi.fn(),
  runApiCompile: vi.fn(),
  getApiUsage: vi.fn(),
}));

vi.mock('@/lib/api/auth', () => ({ authenticateApiRequest: mocks.authenticate }));
vi.mock('@/lib/api/compile', () => ({ runApiCompile: mocks.runApiCompile, getApiUsage: mocks.getApiUsage }));
vi.mock('@/lib/posthog-server', () => ({ captureServerExceptionAfterResponse: vi.fn() }));

import * as compileRoute from '@/app/api/v1/compile/route';
import * as mcpRoute from '@/app/api/mcp/route';
import * as meRoute from '@/app/api/v1/me/route';
import { GET as openApi } from '@/app/api/v1/openapi.json/route';

const PRINCIPAL = { userId: 'user-1', keyId: 'key-1', plan: 'free' };
const DOC = '\\documentclass{article}\\begin{document}Hi\\end{document}';
const PDF = Buffer.from('%PDF-1.5 fake');

function post(url: string, body: unknown, headers: Record<string, string> = {}) {
  return new Request(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer oct_live_x', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

describe('POST /api/v1/compile', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authenticate.mockResolvedValue({ ok: true, principal: PRINCIPAL });
  });

  it('returns the auth response unchanged', async () => {
    const denied = new Response('{}', { status: 401, headers: { 'WWW-Authenticate': 'Bearer' } });
    mocks.authenticate.mockResolvedValue({ ok: false, response: denied });
    expect(await compileRoute.POST(post('https://x/api/v1/compile', { latex: DOC }))).toBe(denied);
    expect(mocks.runApiCompile).not.toHaveBeenCalled();
  });

  it('400s on bad JSON and invalid bodies without compiling', async () => {
    const bad = await compileRoute.POST(post('https://x/api/v1/compile', '{nope'));
    expect(bad.status).toBe(400);
    expect(await bad.json()).toMatchObject({ error: 'invalid_request' });
    const empty = await compileRoute.POST(post('https://x/api/v1/compile', {}));
    expect(empty.status).toBe(400);
    expect(mocks.runApiCompile).not.toHaveBeenCalled();
  });

  it('answers a LaTeX failure with HTTP 200 and ok:false', async () => {
    mocks.runApiCompile.mockResolvedValue({ kind: 'result', json: { ok: false, errors: [], log_tail: '', duration_ms: 3 } });
    const response = await compileRoute.POST(post('https://x/api/v1/compile', { latex: DOC }));
    expect(response.status).toBe(200);
    expect(response.headers.get('access-control-allow-origin')).toBe('*');
    expect(await response.json()).toMatchObject({ ok: false });
    expect(mocks.runApiCompile).toHaveBeenCalledWith(PRINCIPAL, expect.objectContaining({ main: 'main.tex' }), 'rest');
  });

  it('returns the raw PDF for response:"pdf" or Accept: application/pdf', async () => {
    mocks.runApiCompile.mockResolvedValue({
      kind: 'result',
      json: { ok: true, pdf_base64: PDF.toString('base64'), pages: 1, duration_ms: 5, warnings: [], log_tail: '' },
      pdf: PDF,
    });
    for (const request of [
      post('https://x/api/v1/compile', { latex: DOC, response: 'pdf' }),
      post('https://x/api/v1/compile', { latex: DOC }, { Accept: 'application/pdf' }),
    ]) {
      const response = await compileRoute.POST(request);
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toBe('application/pdf');
      expect(Buffer.from(await response.arrayBuffer()).equals(PDF)).toBe(true);
    }
  });

  it('passes quota errors through with their status and headers', async () => {
    mocks.runApiCompile.mockResolvedValue({
      kind: 'error',
      status: 429,
      body: { error: 'quota_exceeded', limit: 30 },
      headers: { 'Retry-After': '100' },
    });
    const response = await compileRoute.POST(post('https://x/api/v1/compile', { latex: DOC }));
    expect(response.status).toBe(429);
    expect(response.headers.get('retry-after')).toBe('100');
  });

  it('GET is 405 with a hint; OPTIONS allows Authorization', async () => {
    const get = await compileRoute.GET();
    expect(get.status).toBe(405);
    expect((await get.json()).message).toMatch(/POST/);
    const options = await compileRoute.OPTIONS();
    expect(options.status).toBe(204);
    expect(options.headers.get('access-control-allow-headers')).toMatch(/Authorization/);
  });
});

describe('/api/mcp', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('requires a key before touching MCP', async () => {
    const denied = new Response('{}', { status: 401, headers: { 'WWW-Authenticate': 'Bearer' } });
    mocks.authenticate.mockResolvedValue({ ok: false, response: denied });
    expect(await mcpRoute.POST(post('https://x/api/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/list' }))).toBe(denied);
  });

  it('serves tools/call statelessly through runApiCompile with via "mcp"', async () => {
    mocks.authenticate.mockResolvedValue({ ok: true, principal: PRINCIPAL });
    mocks.runApiCompile.mockResolvedValue({ kind: 'result', json: { ok: false, errors: [], log_tail: '', duration_ms: 1 } });
    const response = await mcpRoute.POST(
      post(
        'https://x/api/mcp',
        { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'check_latex', arguments: { latex: DOC } } },
        { Accept: 'application/json, text/event-stream', 'Mcp-Protocol-Version': '2025-06-18' }
      )
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('mcp-session-id')).toBeNull();
    expect(response.headers.get('access-control-allow-origin')).toBe('*');
    const json = await response.json();
    expect(json.result.content[0].text).toMatch(/ok=false/);
    expect(mocks.runApiCompile).toHaveBeenCalledWith(PRINCIPAL, expect.anything(), 'mcp', { skipPageCount: true });
  });

  it('refuses a JSON-RPC batch with more than one tools/call before compiling', async () => {
    mocks.authenticate.mockResolvedValue({ ok: true, principal: PRINCIPAL });
    const call = (id: number) => ({
      jsonrpc: '2.0',
      id,
      method: 'tools/call',
      params: { name: 'check_latex', arguments: { latex: DOC } },
    });
    const response = await mcpRoute.POST(
      post('https://x/api/mcp', [call(1), call(2)], { Accept: 'application/json, text/event-stream' })
    );
    expect(response.status).toBe(400);
    expect((await response.json()).error.message).toMatch(/one tool call per request/);
    expect(mocks.runApiCompile).not.toHaveBeenCalled();
  });

  it('answers invalid JSON with a JSON-RPC parse error', async () => {
    mocks.authenticate.mockResolvedValue({ ok: true, principal: PRINCIPAL });
    const response = await mcpRoute.POST(
      new Request('https://x/api/mcp', { method: 'POST', body: '{nope', headers: { 'Content-Type': 'application/json' } })
    );
    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe(-32700);
  });

  it('GET and DELETE are 405 (no sessions)', async () => {
    expect((await mcpRoute.GET()).status).toBe(405);
    expect((await mcpRoute.DELETE()).status).toBe(405);
  });
});

describe('GET /api/v1/me and openapi.json', () => {
  it('returns the usage summary', async () => {
    mocks.authenticate.mockResolvedValue({ ok: true, principal: PRINCIPAL });
    mocks.getApiUsage.mockResolvedValue({ user_id: 'user-1', plan: 'free', daily_limit: 30, used_today: 2 });
    const response = await meRoute.GET(new Request('https://x/api/v1/me', { headers: { Authorization: 'Bearer k' } }));
    expect(await response.json()).toMatchObject({ user_id: 'user-1', plan: 'free', daily_limit: 30, used_today: 2 });
  });

  it('serves an OpenAPI 3.1 document for the endpoints', async () => {
    const doc = await (await openApi()).json();
    expect(doc.openapi).toBe('3.1.0');
    expect(Object.keys(doc.paths).sort()).toEqual(['/api/v1/compile', '/api/v1/me']);
    expect(doc.components.schemas.CompileRequest.properties).not.toHaveProperty('engine');
    expect(doc.info.description).toMatch(/check_latex/);
  });
});
