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
    const response = await transport.handleRequest(request);
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
