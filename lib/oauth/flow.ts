import { isApiKeyFormat, hashApiKey } from '@/lib/api/keys';
import { oauthKeyName, type ClientKind } from '@/lib/oauth/clients';
import type { ValidAuthorizeRequest } from '@/lib/oauth/authorize';
import {
  ACCESS_TOKEN_TTL_SECONDS,
  AUTHORIZATION_CODE_TTL_SECONDS,
  MAX_ACTIVE_OAUTH_GRANTS,
  REFRESH_TOKEN_TTL_SECONDS,
  grantedScope,
  isAcceptedResource,
  type GrantScope,
} from '@/lib/oauth/metadata';
import {
  generateAuthorizationCode,
  generateRefreshToken,
  hashSecret,
  isAuthorizationCodeFormat,
  isRefreshTokenFormat,
  verifyPkce,
} from '@/lib/oauth/tokens';

/**
 * The authorization server's state machine, over a storage interface so it
 * is unit tested without Supabase (lib/oauth/store.ts is the real one).
 *
 *   approve  /oauth/authorize/decision   -> authorization code (60 s, single use)
 *   exchange POST /oauth/token (code)     -> grant + access token + refresh token
 *   refresh  POST /oauth/token (refresh)  -> new access token + new refresh token
 *   revoke   POST /oauth/revoke, Settings -> grant (or one access token) revoked
 *
 * Access tokens are API keys (kind 'oauth', 1 hour). Refresh tokens rotate
 * on every use; presenting a used one again revokes the grant and every
 * token issued under it (OAuth 2.1 section 4.3.1). A code presented twice
 * also revokes the grant it produced (RFC 6749 section 4.1.2). Single use is
 * a conditional update (`used_at is null`), so two concurrent exchanges or
 * refreshes cannot both win.
 */

export interface CodeRow {
  id: string;
  code_hash: string;
  client_id: string;
  client_kind: ClientKind;
  client_name: string | null;
  redirect_uri: string;
  code_challenge: string;
  user_id: string;
  scope: string;
  resource: string | null;
  created_at: string;
  expires_at: string;
  used_at: string | null;
  grant_id: string | null;
}

export type NewCodeRow = Omit<CodeRow, 'id' | 'created_at' | 'used_at' | 'grant_id'>;

export interface GrantRow {
  id: string;
  user_id: string;
  client_id: string;
  client_kind: ClientKind;
  client_name: string | null;
  scope: string;
  resource: string | null;
  created_at: string;
  last_refreshed_at: string | null;
  revoked_at: string | null;
}

export type NewGrantRow = Pick<GrantRow, 'user_id' | 'client_id' | 'client_kind' | 'client_name' | 'scope' | 'resource'>;

export interface RefreshRow {
  id: string;
  grant_id: string;
  token_hash: string;
  expires_at: string;
  used_at: string | null;
}

export interface AccessKeyRow {
  id: string;
  kind: string;
  oauth_grant_id: string | null;
}

export type RevokeReason = 'user' | 'client' | 'refresh_reuse' | 'code_reuse' | 'expired' | 'failed';

/** Storage for the authorization server. Methods throw on database errors. */
export interface OAuthStore {
  insertCode(row: NewCodeRow): Promise<void>;
  findCodeByHash(hash: string): Promise<CodeRow | null>;
  /** Sets used_at only while it is null and the code has not expired; the row or null. */
  claimCode(id: string, at: string): Promise<CodeRow | null>;
  setCodeGrant(id: string, grantId: string): Promise<void>;
  countActiveGrants(userId: string): Promise<number>;
  /** `limit` when the user already has the maximum of active grants. */
  insertGrant(row: NewGrantRow): Promise<{ ok: true; grant: GrantRow } | { ok: false; limit: true }>;
  findGrant(id: string): Promise<GrantRow | null>;
  /** Revokes a live grant (and, by trigger, its access tokens). */
  revokeGrant(id: string, at: string, reason: RevokeReason): Promise<void>;
  touchGrantRefreshed(id: string, at: string): Promise<void>;
  insertRefreshToken(row: { grant_id: string; token_hash: string; expires_at: string }): Promise<void>;
  findRefreshToken(hash: string): Promise<RefreshRow | null>;
  /** Sets used_at only while it is null; the row or null. */
  claimRefreshToken(id: string, at: string): Promise<RefreshRow | null>;
  /** Inserts an API key of kind 'oauth' for the grant (service role). */
  insertAccessKey(row: {
    user_id: string;
    name: string;
    key: string;
    expires_at: string;
    oauth_grant_id: string;
  }): Promise<{ id: string }>;
  findAccessKeyByHash(hash: string): Promise<AccessKeyRow | null>;
  revokeAccessKey(id: string, at: string): Promise<void>;
  /** Records that a DCR client was used (cleanup keeps used clients). */
  touchClient(clientId: string, at: string): Promise<void>;
}

export type TokenErrorCode =
  | 'invalid_request'
  | 'invalid_grant'
  | 'invalid_client'
  | 'invalid_scope'
  | 'invalid_target'
  | 'unsupported_grant_type';

export interface TokenSuccess {
  access_token: string;
  token_type: 'Bearer';
  expires_in: number;
  refresh_token: string;
  scope: GrantScope;
}

export type TokenResult =
  | { ok: true; body: TokenSuccess; grant: GrantRow; refreshed: boolean }
  | { ok: false; error: TokenErrorCode; description: string; status?: number };

function iso(ms: number): string {
  return new Date(ms).toISOString();
}

function err(error: TokenErrorCode, description: string, status = 400): TokenResult {
  return { ok: false, error, description, status };
}

// ---------------------------------------------------------------------------
// Approve: authorization code
// ---------------------------------------------------------------------------

export type IssueCodeResult = { ok: true; code: string } | { ok: false; reason: 'limit' };

export async function issueAuthorizationCode(
  store: OAuthStore,
  input: { request: ValidAuthorizeRequest; userId: string; now: number }
): Promise<IssueCodeResult> {
  // Checked again by the grant insert (trigger); here so the user sees why.
  if ((await store.countActiveGrants(input.userId)) >= MAX_ACTIVE_OAUTH_GRANTS) return { ok: false, reason: 'limit' };
  const { request } = input;
  const code = generateAuthorizationCode();
  await store.insertCode({
    code_hash: hashSecret(code),
    client_id: request.client.client_id,
    client_kind: request.client.kind,
    client_name: request.client.client_name,
    redirect_uri: request.redirectUri,
    code_challenge: request.codeChallenge,
    user_id: input.userId,
    scope: request.scope,
    resource: request.resource,
    expires_at: iso(input.now + AUTHORIZATION_CODE_TTL_SECONDS * 1000),
  });
  if (request.client.kind === 'dcr') await store.touchClient(request.client.client_id, iso(input.now));
  return { ok: true, code };
}

// ---------------------------------------------------------------------------
// Tokens
// ---------------------------------------------------------------------------

async function issueTokens(
  store: OAuthStore,
  grant: GrantRow,
  input: { now: number; generateKey: () => string }
): Promise<TokenSuccess> {
  const accessToken = input.generateKey();
  await store.insertAccessKey({
    user_id: grant.user_id,
    name: oauthKeyName(grant.client_name),
    key: accessToken,
    expires_at: iso(input.now + ACCESS_TOKEN_TTL_SECONDS * 1000),
    oauth_grant_id: grant.id,
  });
  const refreshToken = generateRefreshToken();
  await store.insertRefreshToken({
    grant_id: grant.id,
    token_hash: hashSecret(refreshToken),
    expires_at: iso(input.now + REFRESH_TOKEN_TTL_SECONDS * 1000),
  });
  return {
    access_token: accessToken,
    token_type: 'Bearer',
    expires_in: ACCESS_TOKEN_TTL_SECONDS,
    refresh_token: refreshToken,
    scope: grantedScope(grant.scope),
  };
}

export interface ExchangeInput {
  code: unknown;
  clientId: unknown;
  redirectUri: unknown;
  codeVerifier: unknown;
  resource: unknown;
  origin: string;
  now: number;
  generateKey: () => string;
}

export async function exchangeAuthorizationCode(store: OAuthStore, input: ExchangeInput): Promise<TokenResult> {
  const { code, clientId, redirectUri, codeVerifier, resource } = input;
  if (typeof code !== 'string' || !code) return err('invalid_request', 'code is required.');
  if (typeof clientId !== 'string' || !clientId) return err('invalid_request', 'client_id is required.');
  if (typeof redirectUri !== 'string' || !redirectUri) return err('invalid_request', 'redirect_uri is required.');
  if (typeof codeVerifier !== 'string' || !codeVerifier) return err('invalid_request', 'code_verifier is required (PKCE).');
  if (resource !== undefined && (typeof resource !== 'string' || !isAcceptedResource(resource, input.origin))) {
    return err('invalid_target', 'resource does not name this server.');
  }
  if (!isAuthorizationCodeFormat(code)) return err('invalid_grant', 'Unknown authorization code.');

  const nowIso = iso(input.now);
  const row = await store.findCodeByHash(hashSecret(code));
  if (!row) return err('invalid_grant', 'Unknown authorization code.');
  if (row.used_at) {
    // Replay: whoever redeemed it first may be an attacker; revoke what it produced.
    if (row.grant_id) await store.revokeGrant(row.grant_id, nowIso, 'code_reuse');
    return err('invalid_grant', 'The authorization code was already used.');
  }
  if (Date.parse(row.expires_at) <= input.now) return err('invalid_grant', 'The authorization code has expired.');
  const claimed = await store.claimCode(row.id, nowIso);
  if (!claimed) return err('invalid_grant', 'The authorization code was already used or has expired.');

  // The code is spent from here on, whatever the outcome.
  if (claimed.client_id !== clientId) return err('invalid_grant', 'The code was issued to another client.');
  if (claimed.redirect_uri !== redirectUri) return err('invalid_grant', 'redirect_uri does not match the authorization request.');
  if (!verifyPkce(codeVerifier, claimed.code_challenge)) return err('invalid_grant', 'PKCE verification failed.');

  const inserted = await store.insertGrant({
    user_id: claimed.user_id,
    client_id: claimed.client_id,
    client_kind: claimed.client_kind,
    client_name: claimed.client_name,
    scope: grantedScope(claimed.scope),
    resource: claimed.resource,
  });
  if (!inserted.ok) {
    return err('invalid_grant', `This account already has ${MAX_ACTIVE_OAUTH_GRANTS} connected apps. Revoke one in Octree Settings.`);
  }
  const { grant } = inserted;
  await store.setCodeGrant(claimed.id, grant.id);
  try {
    return { ok: true, grant, refreshed: false, body: await issueTokens(store, grant, input) };
  } catch (error) {
    await store.revokeGrant(grant.id, nowIso, 'failed').catch(() => undefined);
    throw error;
  }
}

export interface RefreshInput {
  refreshToken: unknown;
  clientId: unknown;
  scope: unknown;
  resource: unknown;
  origin: string;
  now: number;
  generateKey: () => string;
}

export async function refreshAccessToken(store: OAuthStore, input: RefreshInput): Promise<TokenResult> {
  const { refreshToken, clientId, scope, resource } = input;
  if (typeof refreshToken !== 'string' || !refreshToken) return err('invalid_request', 'refresh_token is required.');
  if (clientId !== undefined && typeof clientId !== 'string') return err('invalid_request', 'client_id must be a string.');
  if (resource !== undefined && (typeof resource !== 'string' || !isAcceptedResource(resource, input.origin))) {
    return err('invalid_target', 'resource does not name this server.');
  }
  if (!isRefreshTokenFormat(refreshToken)) return err('invalid_grant', 'Unknown refresh token.');

  const nowIso = iso(input.now);
  const row = await store.findRefreshToken(hashSecret(refreshToken));
  if (!row) return err('invalid_grant', 'Unknown refresh token.');
  const grant = await store.findGrant(row.grant_id);
  if (!grant || grant.revoked_at) return err('invalid_grant', 'The authorization was revoked. Connect again.');
  if (clientId && clientId !== grant.client_id) return err('invalid_grant', 'The refresh token was issued to another client.');
  if (row.used_at) {
    await store.revokeGrant(grant.id, nowIso, 'refresh_reuse');
    return err('invalid_grant', 'The refresh token was already used; the authorization has been revoked. Connect again.');
  }
  if (Date.parse(row.expires_at) <= input.now) return err('invalid_grant', 'The refresh token has expired. Connect again.');
  if (typeof scope === 'string' && scope.trim()) {
    const allowed = grant.scope.split(' ');
    if (scope.split(/\s+/).filter(Boolean).some((s) => !allowed.includes(s))) {
      return err('invalid_scope', `scope may not exceed the original grant (${grant.scope}).`);
    }
  }
  const claimed = await store.claimRefreshToken(row.id, nowIso);
  if (!claimed) {
    // Lost a race with another refresh using the same token: that is reuse too.
    await store.revokeGrant(grant.id, nowIso, 'refresh_reuse');
    return err('invalid_grant', 'The refresh token was already used; the authorization has been revoked. Connect again.');
  }
  const body = await issueTokens(store, grant, input);
  await store.touchGrantRefreshed(grant.id, nowIso);
  return { ok: true, grant, refreshed: true, body };
}

// ---------------------------------------------------------------------------
// Revoke (RFC 7009)
// ---------------------------------------------------------------------------

export type RevokeOutcome = { revoked: 'grant' | 'access_token'; grantId: string; userId: string | null } | { revoked: null };

/**
 * Revokes a refresh token (the whole grant) or an OAuth access token (that
 * token only). Unknown tokens, manual API keys and tokens of another client
 * are ignored: the endpoint always answers 200.
 */
export async function revokeToken(
  store: OAuthStore,
  input: { token: unknown; clientId: unknown; now: number }
): Promise<RevokeOutcome> {
  const { token } = input;
  const clientId = typeof input.clientId === 'string' && input.clientId ? input.clientId : null;
  const nowIso = iso(input.now);
  if (isRefreshTokenFormat(token)) {
    const row = await store.findRefreshToken(hashSecret(token));
    if (!row) return { revoked: null };
    const grant = await store.findGrant(row.grant_id);
    if (!grant || grant.revoked_at || (clientId && clientId !== grant.client_id)) return { revoked: null };
    await store.revokeGrant(grant.id, nowIso, 'client');
    return { revoked: 'grant', grantId: grant.id, userId: grant.user_id };
  }
  if (isApiKeyFormat(token)) {
    const key = await store.findAccessKeyByHash(hashApiKey(token));
    if (!key || key.kind !== 'oauth' || !key.oauth_grant_id) return { revoked: null };
    const grant = await store.findGrant(key.oauth_grant_id);
    if (!grant || (clientId && clientId !== grant.client_id)) return { revoked: null };
    await store.revokeAccessKey(key.id, nowIso);
    return { revoked: 'access_token', grantId: grant.id, userId: grant.user_id };
  }
  return { revoked: null };
}
