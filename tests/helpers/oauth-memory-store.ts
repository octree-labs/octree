import { randomUUID } from 'node:crypto';
import { hashApiKey } from '@/lib/api/keys';
import { MAX_ACTIVE_OAUTH_GRANTS } from '@/lib/oauth/metadata';
import type { CodeRow, GrantRow, OAuthStore, RefreshRow, RevokeReason } from '@/lib/oauth/flow';

export interface MemoryKey {
  id: string;
  user_id: string;
  name: string;
  key_hash: string;
  kind: string;
  expires_at: string | null;
  oauth_grant_id: string | null;
  revoked_at: string | null;
}

/**
 * An in-memory OAuthStore with the same conditional-update semantics as
 * lib/oauth/store.ts, including the trigger that revokes a grant's keys.
 */
export function createMemoryOAuthStore() {
  const codes = new Map<string, CodeRow>();
  const grants = new Map<string, GrantRow & { revoked_reason: RevokeReason | null }>();
  const refresh = new Map<string, RefreshRow>();
  const keys = new Map<string, MemoryKey>();
  const touchedClients: string[] = [];
  const createdAt = '2026-11-25T12:00:00.000Z';

  const store: OAuthStore = {
    async insertCode(row) {
      const id = randomUUID();
      codes.set(id, { ...row, id, created_at: createdAt, used_at: null, grant_id: null });
    },
    async findCodeByHash(hash) {
      for (const row of codes.values()) if (row.code_hash === hash) return { ...row };
      return null;
    },
    async claimCode(id, at) {
      const row = codes.get(id);
      if (!row || row.used_at || Date.parse(row.expires_at) <= Date.parse(at)) return null;
      row.used_at = at;
      return { ...row };
    },
    async setCodeGrant(id, grantId) {
      const row = codes.get(id);
      if (row) row.grant_id = grantId;
    },
    async countActiveGrants(userId) {
      return [...grants.values()].filter((g) => g.user_id === userId && !g.revoked_at).length;
    },
    async insertGrant(row) {
      if ((await store.countActiveGrants(row.user_id)) >= MAX_ACTIVE_OAUTH_GRANTS) return { ok: false, limit: true };
      const grant = {
        ...row,
        id: randomUUID(),
        created_at: createdAt,
        last_refreshed_at: null,
        revoked_at: null,
        revoked_reason: null,
      };
      grants.set(grant.id, grant);
      return { ok: true, grant: { ...grant } };
    },
    async findGrant(id) {
      const grant = grants.get(id);
      return grant ? { ...grant } : null;
    },
    async revokeGrant(id, at, reason) {
      const grant = grants.get(id);
      if (!grant || grant.revoked_at) return;
      grant.revoked_at = at;
      grant.revoked_reason = reason;
      for (const key of keys.values()) if (key.oauth_grant_id === id && !key.revoked_at) key.revoked_at = at;
    },
    async touchGrantRefreshed(id, at) {
      const grant = grants.get(id);
      if (grant) grant.last_refreshed_at = at;
    },
    async insertRefreshToken(row) {
      const id = randomUUID();
      refresh.set(id, { ...row, id, used_at: null });
    },
    async findRefreshToken(hash) {
      for (const row of refresh.values()) if (row.token_hash === hash) return { ...row };
      return null;
    },
    async claimRefreshToken(id, at) {
      const row = refresh.get(id);
      if (!row || row.used_at) return null;
      row.used_at = at;
      return { ...row };
    },
    async releaseRefreshToken(id, at) {
      const row = refresh.get(id);
      if (row && row.used_at === at) row.used_at = null;
    },
    async insertAccessKey(row) {
      const id = randomUUID();
      keys.set(id, {
        id,
        user_id: row.user_id,
        name: row.name,
        key_hash: hashApiKey(row.key),
        kind: 'oauth',
        expires_at: row.expires_at,
        oauth_grant_id: row.oauth_grant_id,
        revoked_at: null,
      });
      return { id };
    },
    async findAccessKeyByHash(hash) {
      for (const key of keys.values()) if (key.key_hash === hash) return { id: key.id, kind: key.kind, oauth_grant_id: key.oauth_grant_id };
      return null;
    },
    async revokeAccessKey(id, at) {
      const key = keys.get(id);
      if (key && !key.revoked_at) key.revoked_at = at;
    },
    async touchClient(clientId) {
      touchedClients.push(clientId);
    },
  };

  return { store, codes, grants, refresh, keys, touchedClients };
}
