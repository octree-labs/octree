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

function deps(overrides: Partial<OctreeToolDeps> = {}): OctreeToolDeps {
  return {
    compile: vi.fn(async () => ({
      kind: 'result' as const,
      json: { ok: true as const, pdf_base64: PDF_B64, pages: 2, duration_ms: 900, warnings: [], log_tail: '' },
    })),
    usage: vi.fn(async () => ({ user_id: 'u1', plan: 'free', daily_limit: 30, used_today: 3 })),
    ...overrides,
  };
}

const FAILURE = {
  kind: 'result' as const,
  json: {
    ok: false as const,
    errors: [
      { file: 'main.tex', line: 12, message: 'Undefined control sequence.', kind: 'undefined_control_sequence' as const },
    ],
    log_tail: './main.tex:12: Undefined control sequence.',
    suggestion: 'A command is not defined.',
    duration_ms: 700,
  },
};

describe('compile_latex', () => {
  it('returns a summary and the PDF as an embedded application/pdf resource', async () => {
    const d = deps();
    const result = await compileLatexTool({ latex: DOC }, d);
    expect(d.compile).toHaveBeenCalledWith(
      { files: [{ path: 'main.tex', content: DOC }], main: 'main.tex', response: 'json', sourceBytes: DOC.length },
      {}
    );
    expect(result.isError).toBeUndefined();
    expect(result.content[0]).toMatchObject({ type: 'text' });
    expect((result.content[0] as { text: string }).text).toMatch(/ok=true.*2 pages/);
    expect(result.content[1]).toMatchObject({
      type: 'resource',
      resource: { mimeType: 'application/pdf', blob: PDF_B64 },
    });
  });

  it('reports LaTeX errors as structured data, not as a tool error', async () => {
    const result = await compileLatexTool({ files: [{ path: 'main.tex', content: DOC }] }, deps({ compile: vi.fn(async () => FAILURE) }));
    expect(result.isError).toBeUndefined();
    expect(result.content).toHaveLength(1);
    const text = (result.content[0] as { text: string }).text;
    expect(text).toContain('- main.tex:12 [undefined_control_sequence] Undefined control sequence.');
    expect(text).toContain('"kind": "undefined_control_sequence"');
    expect(text).toContain('Suggestion: A command is not defined.');
  });

  it('is a tool error for invalid input, quota and service problems', async () => {
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
          body: { error: 'quota_exceeded', message: 'Daily API compile limit of 30 reached.', limit: 30 },
        })),
      })
    );
    expect(quota.isError).toBe(true);
    expect((quota.content[0] as { text: string }).text).toMatch(/limit of 30 reached[\s\S]*quota_exceeded/);
  });
});

describe('check_latex', () => {
  it('compiles (counting toward quota) but returns no PDF', async () => {
    const d = deps();
    const result = await checkLatexTool({ latex: DOC }, d);
    expect(d.compile).toHaveBeenCalledWith(expect.objectContaining({ main: 'main.tex' }), { skipPageCount: true });
    expect(result.content).toHaveLength(1);
    expect((result.content[0] as { text: string }).text).toMatch(/No errors \(ok=true\)/);
  });

  it('returns the errors on failure', async () => {
    const result = await checkLatexTool({ latex: DOC }, deps({ compile: vi.fn(async () => FAILURE) }));
    expect((result.content[0] as { text: string }).text).toMatch(/ok=false[\s\S]*main\.tex:12/);
  });
});

describe('get_quota', () => {
  it('returns the usage summary', async () => {
    const result = await getQuotaTool(deps());
    expect(JSON.parse((result.content[0] as { text: string }).text)).toEqual({
      user_id: 'u1',
      plan: 'free',
      daily_limit: 30,
      used_today: 3,
    });
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
    expect(json.result.instructions).toMatch(/structured errors/);
  });

  it('lists the three tools', async () => {
    const { json } = await rpc(deps(), { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
    expect(json.result.tools.map((t: { name: string }) => t.name).sort()).toEqual(['check_latex', 'compile_latex', 'get_quota']);
    const compile = json.result.tools.find((t: { name: string }) => t.name === 'compile_latex');
    expect(Object.keys(compile.inputSchema.properties).sort()).toEqual(['files', 'latex', 'main']);
    const check = json.result.tools.find((t: { name: string }) => t.name === 'check_latex');
    expect(check.description).toMatch(/counts toward the daily compile quota/);
  });

  it('calls compile_latex end to end', async () => {
    const { json } = await rpc(deps(), {
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: { name: 'compile_latex', arguments: { latex: DOC } },
    });
    expect(json.result.content[1].resource.mimeType).toBe('application/pdf');
  });
});
