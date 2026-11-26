import { CLIENT_ID_MAX_LENGTH, type ClientInfo } from '@/lib/oauth/clients';
import { grantedScope, isAcceptedResource, oauthIssuer, mcpResourceUrl, type GrantScope } from '@/lib/oauth/metadata';
import { findMatchingRedirectUri, isLoopbackRedirect } from '@/lib/oauth/redirect-uri';
import { isCodeChallenge } from '@/lib/oauth/tokens';

/**
 * Validation of an authorization request (GET /oauth/authorize, and again
 * on POST /oauth/authorize/decision, which receives the same parameters).
 *
 * Order matters (RFC 6749 section 4.1.2.1): until the client and its
 * redirect_uri are known good, errors are shown on Octree's own page and
 * never redirected. After that, errors go back to the client's redirect_uri
 * as `error=...&state=...&iss=...`.
 *
 * Pure apart from the injected client lookup, so it is unit tested.
 */

export const AUTHORIZE_PARAM_NAMES = [
  'response_type',
  'client_id',
  'redirect_uri',
  'code_challenge',
  'code_challenge_method',
  'state',
  'scope',
  'resource',
] as const;
export type AuthorizeParams = Partial<Record<(typeof AUTHORIZE_PARAM_NAMES)[number], string>>;

const STATE_MAX_LENGTH = 1024;
const SCOPE_MAX_LENGTH = 512;

export interface ValidAuthorizeRequest {
  client: ClientInfo;
  redirectUri: string;
  codeChallenge: string;
  state: string | null;
  scope: GrantScope;
  /** The canonical resource the token is for (the MCP endpoint unless the client named the origin). */
  resource: string;
  /** Every registered redirect URI of the client is a loopback one (extra warning on the consent screen). */
  loopbackOnly: boolean;
}

export type ClientResolver = (clientId: string) => Promise<{ ok: true; client: ClientInfo } | { ok: false; reason: string }>;

export type AuthorizeValidation =
  | { ok: true; request: ValidAuthorizeRequest }
  /** Shown on Octree's error page: the client or redirect_uri cannot be trusted. */
  | { ok: false; kind: 'page'; title: string; description: string }
  /** Sent back to the client. */
  | { ok: false; kind: 'redirect'; location: string };

/** Picks the known authorize parameters out of a query (first value of each, strings only). */
export function pickAuthorizeParams(source: Record<string, string | string[] | undefined> | URLSearchParams | FormData): AuthorizeParams {
  const params: AuthorizeParams = {};
  for (const name of AUTHORIZE_PARAM_NAMES) {
    let value: unknown;
    if (source instanceof URLSearchParams || (typeof FormData !== 'undefined' && source instanceof FormData)) {
      value = source.get(name);
    } else {
      const raw = (source as Record<string, string | string[] | undefined>)[name];
      value = Array.isArray(raw) ? raw[0] : raw;
    }
    if (typeof value === 'string' && value !== '') params[name] = value;
  }
  return params;
}

/** The query string of an authorize URL with these parameters (for the login round trip). */
export function authorizeQuery(params: AuthorizeParams): string {
  const search = new URLSearchParams();
  for (const name of AUTHORIZE_PARAM_NAMES) {
    const value = params[name];
    if (value) search.set(name, value);
  }
  return search.toString();
}

/** `redirect_uri?...&state=...&iss=...` (RFC 9207 `iss` on every response). */
export function buildClientRedirect(
  redirectUri: string,
  values: Record<string, string | null | undefined>,
  origin: string
): string {
  const url = new URL(redirectUri);
  for (const [name, value] of Object.entries(values)) if (value) url.searchParams.set(name, value);
  url.searchParams.set('iss', oauthIssuer(origin));
  return url.toString();
}

function page(title: string, description: string): AuthorizeValidation {
  return { ok: false, kind: 'page', title, description };
}

export async function validateAuthorizeRequest(
  params: AuthorizeParams,
  input: { origin: string; resolveClient: ClientResolver }
): Promise<AuthorizeValidation> {
  const clientId = params.client_id;
  if (!clientId) return page('Missing client_id', 'The app did not say who it is. Start the connection again from the app.');
  if (clientId.length > CLIENT_ID_MAX_LENGTH) return page('Unknown app', 'The client_id is too long.');

  const resolved = await input.resolveClient(clientId);
  if (!resolved.ok) return page('Unknown app', resolved.reason);
  const { client } = resolved;

  const presented = params.redirect_uri;
  if (!presented) return page('Missing redirect_uri', 'The app did not say where to send you back. Start again from the app.');
  const registered = findMatchingRedirectUri(client.redirect_uris, presented);
  if (!registered) {
    return page(
      'Redirect address not registered',
      'The app asked to send you to an address it did not register, so Octree will not send you there.'
    );
  }

  const state = params.state ?? null;
  const fail = (error: string, description: string): AuthorizeValidation => ({
    ok: false,
    kind: 'redirect',
    location: buildClientRedirect(
      presented,
      { error, error_description: description, state: state && state.length <= STATE_MAX_LENGTH ? state : null },
      input.origin
    ),
  });

  if (state !== null && state.length > STATE_MAX_LENGTH) return fail('invalid_request', 'state is too long.');
  if (params.response_type !== 'code') return fail('unsupported_response_type', 'Only response_type=code is supported.');
  if (!params.code_challenge) return fail('invalid_request', 'PKCE is required: send code_challenge with code_challenge_method=S256.');
  if (params.code_challenge_method !== 'S256') return fail('invalid_request', 'code_challenge_method must be S256.');
  if (!isCodeChallenge(params.code_challenge)) return fail('invalid_request', 'code_challenge must be 43 base64url characters.');
  if (params.scope && params.scope.length > SCOPE_MAX_LENGTH) return fail('invalid_scope', 'scope is too long.');
  if (params.resource && !isAcceptedResource(params.resource, input.origin)) {
    return fail('invalid_target', `resource must be ${mcpResourceUrl(input.origin)}.`);
  }

  return {
    ok: true,
    request: {
      client,
      redirectUri: presented,
      codeChallenge: params.code_challenge,
      state,
      scope: grantedScope(params.scope),
      resource: mcpResourceUrl(input.origin),
      loopbackOnly: client.redirect_uris.every(isLoopbackRedirect),
    },
  };
}
