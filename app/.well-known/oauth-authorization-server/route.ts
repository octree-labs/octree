import { authorizationServerMetadataResponse, discoveryPreflight } from '@/lib/oauth/discovery-routes';

/** GET /.well-known/oauth-authorization-server (RFC 8414): Octree's OAuth 2.1 authorization server. */

export const dynamic = 'force-dynamic';

export function GET(request: Request) {
  return authorizationServerMetadataResponse(request);
}

export function OPTIONS() {
  return discoveryPreflight();
}
