import { apiJson, apiPreflight } from '@/lib/api/http';
import { requestOrigin } from '@/lib/api/origin';
import { authorizationServerMetadata, protectedResourceMetadata } from '@/lib/oauth/metadata';

/**
 * Handlers of the public discovery documents (app/.well-known/*). No auth,
 * CORS-open (browser-based MCP clients read them), cacheable for an hour.
 * The origin comes from the request, so preview deployments describe
 * themselves.
 */

const CACHE = { 'Cache-Control': 'public, max-age=3600' };

export function protectedResourceMetadataResponse(request: Request): Response {
  return apiJson(protectedResourceMetadata(requestOrigin(request)), 200, CACHE);
}

export function authorizationServerMetadataResponse(request: Request): Response {
  return apiJson(authorizationServerMetadata(requestOrigin(request)), 200, CACHE);
}

export function discoveryPreflight(): Response {
  return apiPreflight();
}
