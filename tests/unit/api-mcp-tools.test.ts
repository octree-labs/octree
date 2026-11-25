// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import {
  checkLatexTool,
  compileLatexTool,
  createOctreeMcpServer,
  getQuotaTool,
  OCTREE_MCP_INSTRUCTIONS,
  type OctreeToolDeps,
} from '@/lib/mcp/octree-server';

const DOC = '\\documentclass{article}\\begin{document}Hi\\end{document}';
const PDF_B64 = Buffer.from('%PDF-1.5 fake').toString('base64');

const QUOTA = { counter: 'compiles' as const, limit: 30, used: 3, remaining: 27, resets_at: '2026-11-26T00:00:00.000Z' };
const PDF_URL = 'https://sb.example/storage/v1/object/sign/api-artifacts/2026-11-25/u1/a.pdf?token=t';

function success(overrides: Record<string, unknown> = {}) {
  return {
    kind: 'result' as const,
    json: {
      ok: true as const,
      pdf_base64: PDF_B64,
      pdf_url: PDF_URL,
      pdf_url_expires_at: '2026-11-25T13:00:00.000Z',
      pages: 2,
      engine: 'pdflatex' as const,
      duration_ms: 900,
      warnings: [],
      log_tail: '',
      quota: QUOTA,
      ...overrides,
    },
  };
}

const USAGE = {
  user_id: 'u1',
  plan: 'free',
  daily_limit: 30,
  used_today: 3,
  remaining_today: 27,
  checks_daily_limit: 200,
  checks_used_today: 10,
  resets_at: '2026-11-26T00:00:00.000Z',
  upgrade_url: 'https://app.useoctree.com/pricing?from=api',
};

function deps(overrides: Partial<OctreeToolDeps> = {}): OctreeToolDeps {
  return {
    compile: vi.fn(async () => success()),
    usage: vi.fn(async () => USAGE),
    ...overrides,
  };
}

const FAILURE = {
  kind: 'result' as const,
  json: {
    ok: false as const,
    errors: [
      {
        file: 'main.tex',
        line: 12,
        message: 'Undefined control sequence.',
        kind: 'undefined_control_sequence' as const,
        hint: '\\includegraphics is provided by graphicx: add \\usepackage{graphicx} to the preamble.',
      },
    ],
    warnings: ["LaTeX Warning: Reference `fig:1' on page 1 undefined on input line 20."],
    log_tail: './main.tex:12: Undefined control sequence.',
    suggestion: 'A command is not defined.',
    engine: 'pdflatex' as const,
    duration_ms: 700,
    quota: QUOTA,
  },
};

const text = (result: { content: unknown[] }, i = 0) => (result.content[i] as { text: string }).text;

describe('compile_latex', () => {
  it('returns a summary, a resource_link to the signed PDF and structured content, without base64 by default', async () => {
    const d = deps();
    const result = await compileLatexTool({ latex: DOC }, d);
    expect(d.compile).toHaveBeenCalledWith(
      { files: [{ path: 'main.tex', content: DOC }], main: 'main.tex', response: 'json', sourceBytes: DOC.length },
      { mode: 'compile', storePdf: true }
    );
    expect(result.isError).toBeUndefined();
    expect(text(result)).toMatch(/ok=true.*2 pages, pdflatex, 900 ms/);
    expect(text(result)).toContain(PDF_URL);
    expect(text(result)).toContain('Quota: 27 of 30 compiles left today');
    expect(result.content).toHaveLength(2);
    expect(result.content[1]).toMatchObject({ type: 'resource_link', uri: PDF_URL, mimeType: 'application/pdf', name: 'output.pdf' });
    expect(JSON.stringify(result.content)).not.toContain(PDF_B64);
    expect(result.structuredContent).toEqual({
      ok: true,
      engine: 'pdflatex',
      duration_ms: 900,
      errors: [],
      warnings: [],
      suggestion: null,
      quota: QUOTA,
      pages: 2,
      pdf_url: PDF_URL,
      pdf_url_expires_at: '2026-11-25T13:00:00.000Z',
      pdf_bytes: Buffer.from(PDF_B64, 'base64').length,
    });
  });

  it('attaches the PDF inline when include_pdf_base64 is set', async () => {
    const result = await compileLatexTool({ latex: DOC, include_pdf_base64: true }, deps());
    expect(result.content.map((c) => c.type)).toEqual(['text', 'resource_link', 'resource']);
    expect(result.content[2]).toMatchObject({ type: 'resource', resource: { mimeType: 'application/pdf', blob: PDF_B64 } });
  });

  it('gives clients older than MCP 2025-06-18 the embedded PDF and no resource_link', async () => {
    const result = await compileLatexTool({ latex: DOC }, { ...deps(), legacyContent: true });
    expect(result.content.map((c) => c.type)).toEqual(['text', 'resource']);
    expect(result.content[1]).toMatchObject({ type: 'resource', resource: { mimeType: 'application/pdf', blob: PDF_B64 } });
  });

  it('falls back to the inline PDF when no link could be created', async () => {
    const result = await compileLatexTool({ latex: DOC }, deps({ compile: vi.fn(async () => success({ pdf_url: null, pdf_url_expires_at: null })) }));
    expect(result.content.map((c) => c.type)).toEqual(['text', 'resource']);
    expect(result.structuredContent).toMatchObject({ ok: true, pdf_url: null });
  });

  it('reports LaTeX errors as structured data with hints, not as a tool error', async () => {
    const result = await compileLatexTool({ files: [{ path: 'main.tex', content: DOC }] }, deps({ compile: vi.fn(async () => FAILURE) }));
    expect(result.isError).toBeUndefined();
    expect(result.content).toHaveLength(1);
    expect(text(result)).toContain('1. main.tex:12 [undefined_control_sequence] Undefined control sequence.');
    expect(text(result)).toContain('Hint: \\includegraphics is provided by graphicx');
    expect(text(result)).toContain('Quota: 27 of 30');
    expect(result.structuredContent).toMatchObject({
      ok: false,
      engine: 'pdflatex',
      errors: [{ file: 'main.tex', line: 12, kind: 'undefined_control_sequence', hint: expect.stringContaining('graphicx') }],
      warnings: [{ file: null, line: 20, message: expect.stringContaining('fig:1') }],
      suggestion: 'A command is not defined.',
      pdf_url: null,
      pages: null,
      quota: QUOTA,
    });
  });

  it('is a tool error for invalid input, quota and service problems, with the next step for quota', async () => {
    const d = deps();
    const invalid = await compileLatexTool({}, d);
    expect(invalid.isError).toBe(true);
    expect(d.compile).not.toHaveBeenCalled();

    const quota = await compileLatexTool(
      { latex: DOC },
      deps({
        compile: vi.fn(async () => ({
          kind: 'error' as const,
          status: 429,
          body: {
            error: 'quota_exceeded',
            message: 'Daily API compile limit of 30 reached.',
            limit: 30,
            resets_at: '2026-11-26T00:00:00.000Z',
            upgrade_url: 'https://app.useoctree.com/pricing?from=api',
          },
        })),
      })
    );
    expect(quota.isError).toBe(true);
    expect(text(quota)).toMatch(/limit of 30 reached[\s\S]*resets at 2026-11-26T00:00:00.000Z[\s\S]*pricing\?from=api[\s\S]*quota_exceeded/);

    const pro = await compileLatexTool(
      { latex: DOC },
      deps({
        compile: vi.fn(async () => ({
          kind: 'error' as const,
          status: 429,
          body: { error: 'quota_exceeded', message: 'Daily API compile limit of 1000 reached.', plan: 'pro', upgrade_url: 'https://app.useoctree.com/pricing?from=api' },
        })),
      })
    );
    expect(text(pro)).not.toMatch(/with Pro:/);
  });

  it('also serializes the structured result into the text block', async () => {
    const ok = await compileLatexTool({ latex: DOC }, deps());
    expect(JSON.parse(text(ok).slice(text(ok).indexOf('\n{')))).toEqual(ok.structuredContent);
    const failed = await compileLatexTool({ latex: DOC }, deps({ compile: vi.fn(async () => FAILURE) }));
    const { log_tail: _omit, ...rest } = failed.structuredContent as Record<string, unknown>;
    expect(JSON.parse(text(failed).slice(text(failed).indexOf('\n{')))).toEqual(rest);
    const quota = await getQuotaTool(deps());
    expect(JSON.parse(text(quota).slice(text(quota).indexOf('\n{')))).toEqual(USAGE);
  });
});

describe('check_latex', () => {
  it('compiles in check mode (own counter) and returns no PDF', async () => {
    const d = deps({
      compile: vi.fn(async () => success({ pdf_url: undefined, pages: undefined, quota: { ...QUOTA, counter: 'checks', limit: 200, remaining: 197 } })),
    });
    const result = await checkLatexTool({ latex: DOC }, d);
    expect(d.compile).toHaveBeenCalledWith(expect.objectContaining({ main: 'main.tex' }), { mode: 'check' });
    expect(result.content).toHaveLength(1);
    expect(text(result)).toMatch(/No errors \(ok=true\)/);
    expect(text(result)).toContain('197 of 200 checks left');
    expect(result.structuredContent).toMatchObject({ ok: true, errors: [], quota: { counter: 'checks' } });
    expect(result.structuredContent).not.toHaveProperty('pdf_url');
  });

  it('returns the errors on failure', async () => {
    const result = await checkLatexTool({ latex: DOC }, deps({ compile: vi.fn(async () => FAILURE) }));
    expect(text(result)).toMatch(/ok=false[\s\S]*main\.tex:12/);
    expect(result.structuredContent).toMatchObject({ ok: false, errors: [{ line: 12 }] });
  });
});

describe('get_quota', () => {
  it('returns the usage summary as text and structured content', async () => {
    const result = await getQuotaTool(deps());
    expect(result.structuredContent).toEqual(USAGE);
    expect(text(result)).toMatch(/Compiles: 3 of 30 used today; checks: 10 of 200/);
    expect(text(result)).toContain('pricing?from=api');
  });
});

describe('MCP server over stateless Streamable HTTP', () => {
  async function rpc(d: OctreeToolDeps, body: unknown) {
    const server = createOctreeMcpServer(d);
    const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    await server.connect(transport);
    const response = await transport.handleRequest(
      new Request('https://app.useoctree.com/api/mcp', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
          'Mcp-Protocol-Version': '2025-06-18',
        },
        body: JSON.stringify(body),
      })
    );
    return { status: response.status, json: await response.json() };
  }

  it('initializes as "octree" with instructions', async () => {
    const { status, json } = await rpc(deps(), {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } },
    });
    expect(status).toBe(200);
    expect(json.result.serverInfo.name).toBe('octree');
    expect(json.result.instructions).toBe(OCTREE_MCP_INSTRUCTIONS);
    expect(json.result.instructions).toMatch(/structuredContent/);
    expect(json.result.instructions).toMatch(/24 hours/);
  });

  it('lists the three tools with output schemas and annotations', async () => {
    const { json } = await rpc(deps(), { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
    type Tool = { name: string; description: string; inputSchema: any; outputSchema: any; annotations: any };
    const tools = json.result.tools as Tool[];
    expect(tools.map((t) => t.name).sort()).toEqual(['check_latex', 'compile_latex', 'get_quota']);
    const compile = tools.find((t) => t.name === 'compile_latex')!;
    expect(Object.keys(compile.inputSchema.properties).sort()).toEqual(['files', 'include_pdf_base64', 'latex', 'main']);
    expect(compile.outputSchema.required).toEqual(expect.arrayContaining(['ok', 'engine', 'errors', 'warnings', 'pdf_url', 'pages', 'quota']));
    expect(compile.outputSchema.properties.errors.items.properties).toHaveProperty('hint');
    const check = tools.find((t) => t.name === 'check_latex')!;
    expect(Object.keys(check.inputSchema.properties).sort()).toEqual(['files', 'latex', 'main']);
    expect(check.outputSchema.properties).not.toHaveProperty('pdf_url');
    expect(check.description).toMatch(/separate, larger daily allowance/);
    for (const tool of tools) {
      expect(tool.annotations).toEqual({
        title: expect.any(String),
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      });
      expect(tool.outputSchema.type).toBe('object');
    }
  });

  it('calls compile_latex end to end', async () => {
    const { json } = await rpc(deps(), {
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: { name: 'compile_latex', arguments: { latex: DOC } },
    });
    expect(json.result.content[1]).toMatchObject({ type: 'resource_link', mimeType: 'application/pdf' });
    expect(json.result.structuredContent).toMatchObject({ ok: true, pdf_url: PDF_URL });
    expect(json.result.isError).toBeUndefined();
  });

  it('validates structured content against the output schema (failure and quota results pass)', async () => {
    for (const [name, d] of [
      ['compile_latex', deps({ compile: vi.fn(async () => FAILURE) })],
      ['check_latex', deps({ compile: vi.fn(async () => FAILURE) })],
      ['get_quota', deps()],
    ] as const) {
      const { json } = await rpc(d, {
        jsonrpc: '2.0',
        id: 4,
        method: 'tools/call',
        params: { name, arguments: name === 'get_quota' ? {} : { latex: DOC } },
      });
      expect(json.error).toBeUndefined();
      expect(json.result.isError).toBeUndefined();
      expect(json.result.structuredContent).toBeDefined();
    }
  });
});
