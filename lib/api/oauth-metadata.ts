/**
 * OAuth discovery for the MCP server (RFC 9728 protected resource metadata)
 * and the `WWW-Authenticate` challenge that points MCP clients at it.
 *
 * The authorization server is Supabase Auth's OAuth 2.1 server, whose issuer
 * is `<NEXT_PUBLIC_SUPABASE_URL>/auth/v1` (its own metadata lives at
 * `<supabase url>/.well-known/oauth-authorization-server/auth/v1`). Octree is
 * only the resource server: it publishes the metadata below, verifies the
 * access tokens (lib/api/oauth.ts) and hosts the consent page
 * (app/oauth/consent).
 *
 * Pure (env passed in or read lazily), so it is unit tested on its own.
 */

/** The path of the MCP endpoint; the `resource` is `<origin>` + this. */
export const MCP_PATH = '/api/mcp';
export const PROTECTED_RESOURCE_METADATA_PATH = '/.well-known/oauth-protected-resource';

/**
 * Scopes Octree asks for. Supabase's OAuth scopes (openid, email, profile,
 * phone) only shape ID tokens and /userinfo; compiling needs none of them,
 * so the minimum is requested. `openid` is left out on purpose: it needs an
 * asymmetric signing key for the ID token.
 */
export const OAUTH_SCOPES = ['email'] as const;

/** Supabase Auth's issuer, or null when NEXT_PUBLIC_SUPABASE_URL is unset. */
export function oauthIssuer(supabaseUrl: string | undefined = process.env.NEXT_PUBLIC_SUPABASE_URL): string | null {
  const base = supabaseUrl?.trim().replace(/\/+$/, '');
  if (!base) return null;
  return `${base}/auth/v1`;
}

/** `https://app.useoctree.com` from a request (scheme + host, no path). */
export function requestOrigin(request: Request): string {
  return new URL(request.url).origin;
}

/** The canonical resource identifier of the MCP server: `https://app.useoctree.com/api/mcp`. */
export function mcpResourceUrl(origin: string): string {
  return `${origin.replace(/\/+$/, '')}${MCP_PATH}`;
}

export function protectedResourceMetadataUrl(origin: string): string {
  return `${origin.replace(/\/+$/, '')}${PROTECTED_RESOURCE_METADATA_PATH}`;
}

export interface ProtectedResourceMetadata {
  resource: string;
  authorization_servers: string[];
  scopes_supported: string[];
  bearer_methods_supported: string[];
  resource_name: string;
  resource_documentation: string;
}

/** The RFC 9728 document served at /.well-known/oauth-protected-resource(/api/mcp). */
export function protectedResourceMetadata(origin: string, issuer: string | null = oauthIssuer()): ProtectedResourceMetadata {
  return {
    resource: mcpResourceUrl(origin),
    authorization_servers: issuer ? [issuer] : [],
    scopes_supported: [...OAUTH_SCOPES],
    bearer_methods_supported: ['header'],
    resource_name: 'Octree LaTeX compiler',
    resource_documentation: 'https://useoctree.com/developers',
  };
}

export interface ChallengeOptions {
  /** RFC 6750 error code; omitted when no credentials were sent. */
  error?: 'invalid_token' | 'insufficient_scope';
  description?: string;
}

function quote(value: string): string {
  return `"${value.replace(/["\\]/g, '')}"`;
}

/**
 * `Bearer realm="octree", resource_metadata="<origin>/.well-known/oauth-protected-resource", scope="email"`,
 * plus `error` / `error_description` when a token was sent and refused.
 */
export function bearerChallenge(origin: string, options: ChallengeOptions = {}): string {
  const parts = [
    `realm=${quote('octree')}`,
    `resource_metadata=${quote(protectedResourceMetadataUrl(origin))}`,
    `scope=${quote(OAUTH_SCOPES.join(' '))}`,
  ];
  if (options.error) parts.push(`error=${quote(options.error)}`);
  if (options.description) parts.push(`error_description=${quote(options.description)}`);
  return `Bearer ${parts.join(', ')}`;
}
