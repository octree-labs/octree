import { MCP_PATH } from '@/lib/api/origin';

/**
 * Octree's own OAuth 2.1 authorization server, for MCP clients (Claude,
 * ChatGPT, Cursor, VS Code, Claude Code) and the REST API.
 *
 * The issuer is the app origin (`https://app.useoctree.com`). Access tokens
 * are Octree API keys (`oct_live_...`, kind 'oauth', one hour), so they work
 * on /api/v1/* and /api/mcp and nowhere else: not on PostgREST, Storage, the
 * compile service or the agent. That is the point of running the server
 * here instead of using Supabase's OAuth server, whose access tokens are
 * full Supabase session JWTs.
 *
 * Discovery documents and constants. Pure, so it is unit tested on its own.
 */

export const PROTECTED_RESOURCE_METADATA_PATH = '/.well-known/oauth-protected-resource';
export const AUTHORIZATION_SERVER_METADATA_PATH = '/.well-known/oauth-authorization-server';
export const AUTHORIZE_PATH = '/oauth/authorize';
export const AUTHORIZE_DECISION_PATH = '/oauth/authorize/decision';
export const TOKEN_PATH = '/oauth/token';
export const REGISTER_PATH = '/oauth/register';
export const REVOKE_PATH = '/oauth/revoke';
export const DEVELOPERS_DOCS_URL = 'https://www.useoctree.com/developers';

/** What an Octree OAuth token can do: compile (and check) LaTeX and read the plan's API usage. */
export const COMPILE_SCOPE = 'compile';
export const OFFLINE_ACCESS_SCOPE = 'offline_access';
export const SCOPES_SUPPORTED = [COMPILE_SCOPE, OFFLINE_ACCESS_SCOPE] as const;
export type GrantScope = 'compile' | 'compile offline_access';

/** Access tokens (API keys of kind 'oauth') live this long. */
export const ACCESS_TOKEN_TTL_SECONDS = 60 * 60;
/** Each refresh token is valid this long; every refresh issues a new one, so a grant used at least this often never expires. */
export const REFRESH_TOKEN_TTL_SECONDS = 60 * 24 * 60 * 60;
/** Authorization codes are single-use and live this long. */
export const AUTHORIZATION_CODE_TTL_SECONDS = 60;
/** Active OAuth grants ("connected apps") per user; also enforced by the oauth_grants_guard trigger. */
export const MAX_ACTIVE_OAUTH_GRANTS = 20;
export const OAUTH_CLIENT_NAME_MAX_LENGTH = 60;

function trimOrigin(origin: string): string {
  return origin.replace(/\/+$/, '');
}

/** The canonical resource identifier of the MCP server: `https://app.useoctree.com/api/mcp`. */
export function mcpResourceUrl(origin: string): string {
  return `${trimOrigin(origin)}${MCP_PATH}`;
}

export function protectedResourceMetadataUrl(origin: string): string {
  return `${trimOrigin(origin)}${PROTECTED_RESOURCE_METADATA_PATH}`;
}

/** The issuer: the origin itself, no path (so RFC 8414 discovery is `/.well-known/oauth-authorization-server`). */
export function oauthIssuer(origin: string): string {
  return trimOrigin(origin);
}

export interface ProtectedResourceMetadata {
  resource: string;
  authorization_servers: string[];
  scopes_supported: string[];
  bearer_methods_supported: string[];
  resource_name: string;
  resource_documentation: string;
}

/** RFC 9728 document at /.well-known/oauth-protected-resource and /.well-known/oauth-protected-resource/api/mcp. */
export function protectedResourceMetadata(origin: string): ProtectedResourceMetadata {
  return {
    resource: mcpResourceUrl(origin),
    authorization_servers: [oauthIssuer(origin)],
    scopes_supported: [COMPILE_SCOPE],
    bearer_methods_supported: ['header'],
    resource_name: 'Octree LaTeX compiler',
    resource_documentation: DEVELOPERS_DOCS_URL,
  };
}

/** RFC 8414 document at /.well-known/oauth-authorization-server. */
export function authorizationServerMetadata(origin: string) {
  const base = trimOrigin(origin);
  return {
    issuer: oauthIssuer(origin),
    authorization_endpoint: `${base}${AUTHORIZE_PATH}`,
    token_endpoint: `${base}${TOKEN_PATH}`,
    registration_endpoint: `${base}${REGISTER_PATH}`,
    revocation_endpoint: `${base}${REVOKE_PATH}`,
    response_types_supported: ['code'],
    response_modes_supported: ['query'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
    revocation_endpoint_auth_methods_supported: ['none'],
    scopes_supported: [...SCOPES_SUPPORTED],
    client_id_metadata_document_supported: true,
    authorization_response_iss_parameter_supported: true,
    service_documentation: DEVELOPERS_DOCS_URL,
  };
}

export interface ChallengeOptions {
  /** RFC 6750 error code; omitted when no credentials were sent. */
  error?: 'invalid_token' | 'insufficient_scope';
  description?: string;
}

function quote(value: string): string {
  return `"${value.replace(/["\\\r\n]/g, '')}"`;
}

/**
 * `Bearer realm="octree", resource_metadata="<origin>/.well-known/oauth-protected-resource", scope="compile"`,
 * plus `error` / `error_description` when a token was sent and refused.
 * The `resource_metadata` pointer on the 401 is how MCP clients find the
 * authorization server (MCP authorization spec, RFC 9728 section 5.1).
 */
export function bearerChallenge(origin: string, options: ChallengeOptions = {}): string {
  const parts = [
    `realm=${quote('octree')}`,
    `resource_metadata=${quote(protectedResourceMetadataUrl(origin))}`,
    `scope=${quote(COMPILE_SCOPE)}`,
  ];
  if (options.error) parts.push(`error=${quote(options.error)}`);
  if (options.description) parts.push(`error_description=${quote(options.description)}`);
  return `Bearer ${parts.join(', ')}`;
}

/**
 * Whether an RFC 8707 `resource` value names this server: the MCP endpoint
 * (the canonical one) or the origin itself (the REST API). Scheme and host
 * compare case-insensitively and a trailing slash is ignored; anything else
 * (another host, a fragment, another path) is refused with invalid_target.
 */
export function isAcceptedResource(value: string, origin: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.hash || url.search || url.username || url.password) return false;
  if (url.origin !== new URL(origin).origin) return false;
  const path = url.pathname.replace(/\/+$/, '');
  return path === '' || path === MCP_PATH || path === '/api/v1';
}

/** Granted scope from a requested `scope` string: always `compile`; `offline_access` when asked for. Unknown scopes are ignored. */
export function grantedScope(requested: string | null | undefined): GrantScope {
  const parts = (requested ?? '').split(/\s+/).filter(Boolean);
  return parts.includes(OFFLINE_ACCESS_SCOPE) ? 'compile offline_access' : 'compile';
}
