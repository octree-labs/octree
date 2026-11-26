import { discoveryPreflight, protectedResourceMetadataResponse } from '@/lib/oauth/discovery-routes';

/**
 * GET /.well-known/oauth-protected-resource/api/mcp: the path-suffixed form
 * (RFC 9728 section 3.1) that MCP clients probe first for /api/mcp. Same
 * document as /.well-known/oauth-protected-resource.
 */

export const dynamic = 'force-dynamic';

export function GET(request: Request) {
  return protectedResourceMetadataResponse(request);
}

export function OPTIONS() {
  return discoveryPreflight();
}
