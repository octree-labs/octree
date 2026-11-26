import 'server-only';

import { createAdminClient } from '@/lib/supabase/admin';
import { apiKeyDisplayPrefix, hashApiKey } from '@/lib/api/keys';
import { isCimdClientId, isDcrClientId, type ClientInfo, type RegistrationInput } from '@/lib/oauth/clients';
import { resolveCimdClient } from '@/lib/oauth/cimd';
import type { AccessKeyRow, CodeRow, GrantRow, OAuthStore, RefreshRow } from '@/lib/oauth/flow';
import { REFRESH_TOKEN_TTL_SECONDS } from '@/lib/oauth/metadata';

/**
 * The authorization server's storage on the service-role client
 * (migration 20261129000000_oauth_server.sql). Codes, refresh tokens and
 * clients have RLS on with no policies; grants are readable and revocable
 * by their user (Settings), everything else goes through here.
 */

type AdminClient = ReturnType<typeof createAdminClient>;

const CODE_COLUMNS =
  'id, code_hash, client_id, client_kind, client_name, redirect_uri, code_challenge, user_id, scope, resource, created_at, expires_at, used_at, grant_id';
const GRANT_COLUMNS = 'id, user_id, client_id, client_kind, client_name, scope, resource, created_at, last_refreshed_at, revoked_at';
const REFRESH_COLUMNS = 'id, grant_id, token_hash, expires_at, used_at';

function fail(op: string, message: string): never {
  throw new Error(`oauth ${op} failed: ${message}`);
}

export function createOAuthStore(admin: AdminClient = createAdminClient()): OAuthStore {
  return {
    async insertCode(row) {
      const { error } = await admin.from('oauth_authorization_codes').insert(row);
      if (error) fail('code insert', error.message);
    },
    async findCodeByHash(hash) {
      const { data, error } = await admin.from('oauth_authorization_codes').select(CODE_COLUMNS).eq('code_hash', hash).maybeSingle();
      if (error) fail('code select', error.message);
      return (data as CodeRow | null) ?? null;
    },
    async claimCode(id, at) {
      const { data, error } = await admin
        .from('oauth_authorization_codes')
        .update({ used_at: at })
        .eq('id', id)
        .is('used_at', null)
        .gt('expires_at', at)
        .select(CODE_COLUMNS)
        .maybeSingle();
      if (error) fail('code claim', error.message);
      return (data as CodeRow | null) ?? null;
    },
    async setCodeGrant(id, grantId) {
      const { error } = await admin.from('oauth_authorization_codes').update({ grant_id: grantId }).eq('id', id);
      if (error) fail('code update', error.message);
    },
    async countActiveGrants(userId) {
      const { count, error } = await admin
        .from('oauth_grants')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId)
        .is('revoked_at', null);
      if (error) fail('grant count', error.message);
      return count ?? 0;
    },
    async insertGrant(row) {
      const { data, error } = await admin.from('oauth_grants').insert(row).select(GRANT_COLUMNS).single();
      if (error) {
        if (/grant limit reached/i.test(error.message)) return { ok: false, limit: true };
        fail('grant insert', error.message);
      }
      return { ok: true, grant: data as GrantRow };
    },
    async findGrant(id) {
      const { data, error } = await admin.from('oauth_grants').select(GRANT_COLUMNS).eq('id', id).maybeSingle();
      if (error) fail('grant select', error.message);
      return (data as GrantRow | null) ?? null;
    },
    async revokeGrant(id, at, reason) {
      const { error } = await admin
        .from('oauth_grants')
        .update({ revoked_at: at, revoked_reason: reason })
        .eq('id', id)
        .is('revoked_at', null);
      if (error) fail('grant revoke', error.message);
    },
    async touchGrantRefreshed(id, at) {
      const { error } = await admin.from('oauth_grants').update({ last_refreshed_at: at }).eq('id', id);
      if (error) console.error('[oauth] last_refreshed_at update failed:', error.message);
    },
    async insertRefreshToken(row) {
      const { error } = await admin.from('oauth_refresh_tokens').insert(row);
      if (error) fail('refresh insert', error.message);
    },
    async findRefreshToken(hash) {
      const { data, error } = await admin.from('oauth_refresh_tokens').select(REFRESH_COLUMNS).eq('token_hash', hash).maybeSingle();
      if (error) fail('refresh select', error.message);
      return (data as RefreshRow | null) ?? null;
    },
    async claimRefreshToken(id, at) {
      const { data, error } = await admin
        .from('oauth_refresh_tokens')
        .update({ used_at: at })
        .eq('id', id)
        .is('used_at', null)
        .select(REFRESH_COLUMNS)
        .maybeSingle();
      if (error) fail('refresh claim', error.message);
      return (data as RefreshRow | null) ?? null;
    },
    async insertAccessKey(row) {
      const { data, error } = await admin
        .from('api_keys')
        .insert({
          user_id: row.user_id,
          name: row.name,
          key_prefix: apiKeyDisplayPrefix(row.key),
          key_hash: hashApiKey(row.key),
          kind: 'oauth',
          expires_at: row.expires_at,
          oauth_grant_id: row.oauth_grant_id,
        })
        .select('id')
        .single();
      if (error) fail('access key insert', error.message);
      return { id: (data as { id: string }).id };
    },
    async findAccessKeyByHash(hash) {
      const { data, error } = await admin.from('api_keys').select('id, kind, oauth_grant_id').eq('key_hash', hash).maybeSingle();
      if (error) fail('access key select', error.message);
      return (data as AccessKeyRow | null) ?? null;
    },
    async revokeAccessKey(id, at) {
      const { error } = await admin.from('api_keys').update({ revoked_at: at }).eq('id', id).is('revoked_at', null);
      if (error) fail('access key revoke', error.message);
    },
    async touchClient(clientId, at) {
      if (!isDcrClientId(clientId)) return;
      const { error } = await admin.from('oauth_clients').update({ last_used_at: at }).eq('id', clientId);
      if (error) console.error('[oauth] client last_used_at update failed:', error.message);
    },
  };
}

// ---------------------------------------------------------------------------
// Clients
// ---------------------------------------------------------------------------

export async function insertDcrClient(
  input: RegistrationInput & { registration_ip: string | null },
  admin: AdminClient = createAdminClient()
): Promise<{ id: string; created_at: string }> {
  const { data, error } = await admin.from('oauth_clients').insert(input).select('id, created_at').single();
  if (error) fail('client insert', error.message);
  return data as { id: string; created_at: string };
}

/** A client by id: a DCR row, or a Client ID Metadata Document fetched from its URL. */
export async function resolveClient(
  clientId: string,
  admin: AdminClient = createAdminClient()
): Promise<{ ok: true; client: ClientInfo } | { ok: false; reason: string }> {
  if (isDcrClientId(clientId)) {
    const { data, error } = await admin.from('oauth_clients').select('id, client_name, redirect_uris').eq('id', clientId).maybeSingle();
    if (error) fail('client select', error.message);
    if (!data) return { ok: false, reason: 'This app is not registered with Octree (unknown client_id). Connect again from the app.' };
    return {
      ok: true,
      client: {
        client_id: data.id,
        kind: 'dcr',
        client_name: data.client_name,
        redirect_uris: data.redirect_uris,
        metadata_host: null,
      },
    };
  }
  if (isCimdClientId(clientId)) return resolveCimdClient(clientId);
  return { ok: false, reason: 'Unknown client_id.' };
}

/** Whether a client_id names a client that exists (token endpoint: invalid_client otherwise). DCR only; URL ids are not fetched. */
export async function dcrClientExists(clientId: string, admin: AdminClient = createAdminClient()): Promise<boolean> {
  const { data, error } = await admin.from('oauth_clients').select('id').eq('id', clientId).maybeSingle();
  if (error) fail('client select', error.message);
  return Boolean(data);
}

// ---------------------------------------------------------------------------
// Cleanup (hourly cron)
// ---------------------------------------------------------------------------

const DAY_MS = 24 * 60 * 60 * 1000;

export interface OAuthCleanupResult {
  codes_deleted: number;
  refresh_tokens_deleted: number;
  access_keys_deleted: number;
  grants_expired: number;
  grants_deleted: number;
  clients_deleted: number;
}

/**
 * For app/api/cron/api-artifacts:
 *   - codes a day past expiry
 *   - refresh tokens past expiry, or used more than 7 days ago (reuse of
 *     one that old is answered invalid_grant without revoking the grant)
 *   - OAuth access keys a day past expiry (and revoked ones a day old)
 *   - grants unused for the refresh-token lifetime are revoked ('expired');
 *     revoked grants are deleted after 30 days
 *   - DCR clients never used a day after registering, or unused for 180
 *     days with no active grant
 * `dry` counts without changing anything.
 */
export async function cleanupOAuth(admin: AdminClient, now: Date, dry = false): Promise<OAuthCleanupResult> {
  const t = now.getTime();
  const at = (ms: number) => new Date(ms).toISOString();
  const nowIso = now.toISOString();

  const count = async (query: PromiseLike<{ count: number | null; error: { message: string } | null }>, op: string) => {
    const { count: n, error } = await query;
    if (error) fail(op, error.message);
    return n ?? 0;
  };

  const staleGrantCutoff = at(t - REFRESH_TOKEN_TTL_SECONDS * 1000);
  const staleGrantFilter = `and(last_refreshed_at.is.null,created_at.lt.${staleGrantCutoff}),last_refreshed_at.lt.${staleGrantCutoff}`;

  if (dry) {
    return {
      codes_deleted: await count(
        admin.from('oauth_authorization_codes').select('id', { count: 'exact', head: true }).lt('expires_at', at(t - DAY_MS)),
        'code count'
      ),
      refresh_tokens_deleted: await count(
        admin
          .from('oauth_refresh_tokens')
          .select('id', { count: 'exact', head: true })
          .or(`expires_at.lt.${nowIso},used_at.lt.${at(t - 7 * DAY_MS)}`),
        'refresh count'
      ),
      access_keys_deleted: await count(
        admin
          .from('api_keys')
          .select('id', { count: 'exact', head: true })
          .eq('kind', 'oauth')
          .or(`expires_at.lt.${at(t - DAY_MS)},revoked_at.lt.${at(t - DAY_MS)}`),
        'key count'
      ),
      grants_expired: await count(
        admin.from('oauth_grants').select('id', { count: 'exact', head: true }).is('revoked_at', null).or(staleGrantFilter),
        'grant count'
      ),
      grants_deleted: await count(
        admin.from('oauth_grants').select('id', { count: 'exact', head: true }).lt('revoked_at', at(t - 30 * DAY_MS)),
        'grant count'
      ),
      clients_deleted: await count(
        admin
          .from('oauth_clients')
          .select('id', { count: 'exact', head: true })
          .is('last_used_at', null)
          .lt('created_at', at(t - DAY_MS)),
        'client count'
      ),
    };
  }

  const codes = await count(
    admin.from('oauth_authorization_codes').delete({ count: 'exact' }).lt('expires_at', at(t - DAY_MS)),
    'code delete'
  );
  const refresh = await count(
    admin
      .from('oauth_refresh_tokens')
      .delete({ count: 'exact' })
      .or(`expires_at.lt.${nowIso},used_at.lt.${at(t - 7 * DAY_MS)}`),
    'refresh delete'
  );
  const keys = await count(
    admin
      .from('api_keys')
      .delete({ count: 'exact' })
      .eq('kind', 'oauth')
      .or(`expires_at.lt.${at(t - DAY_MS)},revoked_at.lt.${at(t - DAY_MS)}`),
    'key delete'
  );
  const expired = await count(
    admin
      .from('oauth_grants')
      .update({ revoked_at: nowIso, revoked_reason: 'expired' }, { count: 'exact' })
      .is('revoked_at', null)
      .or(staleGrantFilter),
    'grant expire'
  );
  const grants = await count(
    admin.from('oauth_grants').delete({ count: 'exact' }).lt('revoked_at', at(t - 30 * DAY_MS)),
    'grant delete'
  );
  let clients = await count(
    admin.from('oauth_clients').delete({ count: 'exact' }).is('last_used_at', null).lt('created_at', at(t - DAY_MS)),
    'client delete'
  );

  // Long-idle DCR clients without a live grant.
  const { data: idle, error: idleError } = await admin
    .from('oauth_clients')
    .select('id')
    .lt('last_used_at', at(t - 180 * DAY_MS))
    .limit(200);
  if (idleError) fail('client select', idleError.message);
  const idleIds = (idle ?? []).map((row) => row.id);
  if (idleIds.length > 0) {
    const { data: live, error: liveError } = await admin
      .from('oauth_grants')
      .select('client_id')
      .in('client_id', idleIds)
      .is('revoked_at', null);
    if (liveError) fail('grant select', liveError.message);
    const keep = new Set((live ?? []).map((row) => row.client_id));
    const drop = idleIds.filter((id) => !keep.has(id));
    if (drop.length > 0) {
      clients += await count(admin.from('oauth_clients').delete({ count: 'exact' }).in('id', drop), 'client delete');
    }
  }

  return {
    codes_deleted: codes,
    refresh_tokens_deleted: refresh,
    access_keys_deleted: keys,
    grants_expired: expired,
    grants_deleted: grants,
    clients_deleted: clients,
  };
}
