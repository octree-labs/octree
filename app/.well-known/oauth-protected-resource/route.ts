import { discoveryPreflight, protectedResourceMetadataResponse } from '@/lib/oauth/discovery-routes';

/** GET /.well-known/oauth-protected-resource (RFC 9728): the MCP server's resource metadata. */

export const dynamic = 'force-dynamic';

export function GET(request: Request) {
  return protectedResourceMetadataResponse(request);
}

export function OPTIONS() {
  return discoveryPreflight();
}
