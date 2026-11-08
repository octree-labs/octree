import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { authenticateApiRequest } from '@/lib/api/auth';
import { getApiUsage, runApiCompile } from '@/lib/api/compile';
import { apiJson, apiPreflight, withCors } from '@/lib/api/http';
import { createOctreeMcpServer, type OctreeToolDeps } from '@/lib/mcp/octree-server';
import { captureServerExceptionAfterResponse } from '@/lib/posthog-server';

/**
 * POST /api/mcp: the Octree remote MCP server (Streamable HTTP).
 *
 *   claude mcp add --transport http octree https://app.useoctree.com/api/mcp \
 *     --header "Authorization: Bearer oct_live_..."
 *
 * Stateless: every POST builds a fresh server and transport (no session id,
 * no server-side session store) and answers with plain JSON, so it runs on
 * serverless functions. With no sessions there is nothing to GET (no
 * standalone SSE stream) or DELETE, so both are 405 as the spec allows.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/** Bigger than the 2 MB source limit (JSON escaping) but bounded, as in app/api/v1/compile. */
const MAX_BODY_BYTES = 4 * 1024 * 1024;

function isToolCall(message: unknown): boolean {
  return typeof message === 'object' && message !== null && (message as { method?: unknown }).method === 'tools/call';
}

function methodNotAllowed() {
  return apiJson(
    {
      jsonrpc: '2.0',
      error: { code: -32000, message: 'Method not allowed: this MCP server is stateless; send JSON-RPC with POST.' },
      id: null,
    },
    405,
    { Allow: 'POST, OPTIONS' }
  );
}

export async function OPTIONS() {
  return apiPreflight();
}

export async function GET() {
  return methodNotAllowed();
}

export async function DELETE() {
  return methodNotAllowed();
}

export async function POST(request: Request) {
  const auth = await authenticateApiRequest(request);
  if (!auth.ok) return auth.response;
  const { principal } = auth;

  // Same bound as POST /api/v1/compile. The body is read here (not by the
  // transport) so a JSON-RPC batch can be checked before anything runs.
  const tooLarge = () =>
    apiJson({ jsonrpc: '2.0', error: { code: -32600, message: 'Request body is larger than 4 MB.' }, id: null }, 413);
  if (Number(request.headers.get('content-length') ?? 0) > MAX_BODY_BYTES) return tooLarge();
  const text = await request.text();
  if (Buffer.byteLength(text, 'utf8') > MAX_BODY_BYTES) return tooLarge();
  let parsedBody: unknown;
  try {
    parsedBody = JSON.parse(text);
  } catch {
    return apiJson({ jsonrpc: '2.0', error: { code: -32700, message: 'Parse error: invalid JSON' }, id: null }, 400);
  }
  // One compile per HTTP request, as on the REST API: a batch of tools/call
  // would start many compiles at once and outlive maxDuration.
  if (Array.isArray(parsedBody) && parsedBody.filter(isToolCall).length > 1) {
    return apiJson(
      {
        jsonrpc: '2.0',
        error: { code: -32600, message: 'Batched tools/call is not supported; send one tool call per request.' },
        id: null,
      },
      400
    );
  }

  try {
    const deps: OctreeToolDeps = {
      compile: (req, options) => runApiCompile(principal, req, 'mcp', options),
      usage: async () => ({ ...(await getApiUsage(principal)) }),
    };
    const server = createOctreeMcpServer(deps);
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    await server.connect(transport);
    const response = await transport.handleRequest(request, { parsedBody });
    return withCors(response);
  } catch (error) {
    console.error('[api/mcp] unexpected error:', error);
    captureServerExceptionAfterResponse(error, { route: 'api/mcp', distinctId: principal.userId });
    return apiJson(
      { jsonrpc: '2.0', error: { code: -32603, message: 'Internal server error' }, id: null },
      500
    );
  }
}
