import { apiJson, apiPreflight } from '@/lib/api/http';
import { oauthIssuer, protectedResourceMetadata, requestOrigin } from '@/lib/api/oauth-metadata';

/**
 * GET /.well-known/oauth-protected-resource and its path-suffixed form
 * /.well-known/oauth-protected-resource/api/mcp (RFC 9728 section 3.1): the
 * same document, naming the MCP endpoint as the resource and Supabase Auth
 * as its authorization server. Public, CORS-open (browser-based MCP clients
 * read it), cacheable for an hour.
 */
export function protectedResourceMetadataResponse(request: Request): Response {
  const issuer = oauthIssuer();
  if (!issuer) {
    return apiJson({ error: 'service_unavailable', message: 'OAuth is not configured.' }, 503);
  }
  return apiJson(protectedResourceMetadata(requestOrigin(request), issuer), 200, {
    'Cache-Control': 'public, max-age=3600',
  });
}

export function protectedResourcePreflight(): Response {
  return apiPreflight();
}
