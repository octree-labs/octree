import { OAUTH_CLIENT_NAME_MAX_LENGTH } from '@/lib/oauth/metadata';
import { checkRedirectUri, checkRedirectUris } from '@/lib/oauth/redirect-uri';

/**
 * OAuth clients: who may ask for an authorization.
 *
 *   dcr   registered at POST /oauth/register (RFC 7591); client_id is the
 *         oauth_clients row id (a uuid). Its name is whatever it said.
 *   cimd  client_id is an https URL serving a Client ID Metadata Document
 *         (lib/oauth/cimd.ts). The name still comes from the client, but the
 *         document's host is shown on the consent screen and is real.
 *
 * Every client is public (token_endpoint_auth_method "none"): the
 * protection is PKCE plus exact redirect URIs, not a secret.
 *
 * Pure, so it is unit tested on its own.
 */

export type ClientKind = 'dcr' | 'cimd';

export interface ClientInfo {
  client_id: string;
  kind: ClientKind;
  client_name: string | null;
  redirect_uris: string[];
  /** cimd: the host serving the metadata document (shown on the consent screen). */
  metadata_host: string | null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const CLIENT_ID_MAX_LENGTH = 512;

export function isDcrClientId(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value);
}

/**
 * A URL client_id per the CIMD draft: https, a DNS host on the default port,
 * a path other than "/", no fragment, credentials, or dot segments.
 */
export function isCimdClientId(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > CLIENT_ID_MAX_LENGTH || !value.startsWith('https://')) return false;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.href !== value) return false; // normalised form only (no dot segments, no odd escapes)
  if (url.protocol !== 'https:' || url.username || url.password || url.hash || url.port) return false;
  if (!url.hostname.includes('.') || /^[\d.]+$/.test(url.hostname) || url.hostname.startsWith('[')) return false;
  if (url.pathname === '/' || url.pathname === '') return false;
  return true;
}

/** Control and bidi characters out, whitespace collapsed, at most 60 characters (longer names are cut). */
export function sanitizeClientName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const clean = value
    .replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩]/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
  if (!clean) return null;
  return clean.length > OAUTH_CLIENT_NAME_MAX_LENGTH ? clean.slice(0, OAUTH_CLIENT_NAME_MAX_LENGTH).trim() : clean;
}

function optionalString(value: unknown, max: number): string | null {
  return typeof value === 'string' && value.trim() && value.length <= max ? value.trim() : null;
}

function checkPublicClient(fields: Record<string, unknown>): string | null {
  const method = fields.token_endpoint_auth_method;
  if (method !== undefined && method !== 'none') {
    return 'Only public clients are supported: token_endpoint_auth_method must be "none".';
  }
  const grants = fields.grant_types;
  if (grants !== undefined) {
    if (!Array.isArray(grants) || grants.some((g) => g !== 'authorization_code' && g !== 'refresh_token')) {
      return 'grant_types may only contain "authorization_code" and "refresh_token".';
    }
  }
  const responses = fields.response_types;
  if (responses !== undefined) {
    if (!Array.isArray(responses) || responses.some((r) => r !== 'code')) return 'response_types may only contain "code".';
  }
  return null;
}

export interface RegistrationInput {
  client_name: string | null;
  redirect_uris: string[];
  client_uri: string | null;
  software_id: string | null;
  software_version: string | null;
}

export type RegistrationParse =
  | { ok: true; input: RegistrationInput }
  | { ok: false; error: 'invalid_redirect_uri' | 'invalid_client_metadata'; description: string };

/** Validates an RFC 7591 registration request body. */
export function parseRegistrationRequest(fields: Record<string, unknown>): RegistrationParse {
  const uris = checkRedirectUris(fields.redirect_uris);
  if (!uris.ok) return { ok: false, error: 'invalid_redirect_uri', description: uris.reason };
  const problem = checkPublicClient(fields);
  if (problem) return { ok: false, error: 'invalid_client_metadata', description: problem };
  let clientUri: string | null = null;
  if (typeof fields.client_uri === 'string' && fields.client_uri) {
    try {
      const url = new URL(fields.client_uri);
      if (url.protocol === 'https:' && fields.client_uri.length <= 512) clientUri = url.href;
    } catch {
      clientUri = null;
    }
  }
  return {
    ok: true,
    input: {
      client_name: sanitizeClientName(fields.client_name),
      redirect_uris: uris.uris,
      client_uri: clientUri,
      software_id: optionalString(fields.software_id, 128),
      software_version: optionalString(fields.software_version, 64),
    },
  };
}

/**
 * Validates a fetched Client ID Metadata Document for `url`: a JSON object
 * whose client_id is exactly the URL, with valid redirect_uris (invalid
 * entries are dropped; none left is an error) and a public auth method.
 */
export function parseCimdDocument(url: string, doc: unknown): { ok: true; client: ClientInfo } | { ok: false; reason: string } {
  if (typeof doc !== 'object' || doc === null || Array.isArray(doc)) {
    return { ok: false, reason: 'The client metadata document is not a JSON object.' };
  }
  const fields = doc as Record<string, unknown>;
  if (fields.client_id !== url) return { ok: false, reason: 'The metadata document client_id does not match its URL.' };
  if (!Array.isArray(fields.redirect_uris) || fields.redirect_uris.length === 0) {
    return { ok: false, reason: 'The metadata document has no redirect_uris.' };
  }
  const redirectUris = fields.redirect_uris
    .slice(0, 20)
    .map((uri) => checkRedirectUri(uri))
    .flatMap((check) => (check.ok ? [check.uri] : []));
  if (redirectUris.length === 0) return { ok: false, reason: 'None of the metadata document redirect_uris is allowed.' };
  const problem = checkPublicClient(fields);
  if (problem) return { ok: false, reason: problem };
  return {
    ok: true,
    client: {
      client_id: url,
      kind: 'cimd',
      client_name: sanitizeClientName(fields.client_name),
      redirect_uris: redirectUris,
      metadata_host: new URL(url).host,
    },
  };
}

/** The name shown for a client: its own name, or its metadata host, or "An app". */
export function clientDisplayName(client: Pick<ClientInfo, 'client_name' | 'metadata_host'>): string {
  return client.client_name ?? client.metadata_host ?? 'An app';
}

/** API key name for an OAuth access token: `<client> (OAuth)`, within the 64-character limit. */
export function oauthKeyName(clientName: string | null | undefined): string {
  const base = (clientName ?? '').trim() || 'OAuth app';
  return `${base.slice(0, 55).trim()} (OAuth)`;
}
