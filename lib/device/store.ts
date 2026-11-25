import 'server-only';

import { createAdminClient } from '@/lib/supabase/admin';
import type { DeviceRow, DeviceStore } from '@/lib/device/flow';

/**
 * The device authorization store on the service-role client: the table
 * (migration 20261128000000_device_authorizations.sql) has RLS on and no
 * policies, so nothing else can read it.
 */

type AdminClient = ReturnType<typeof createAdminClient>;

const COLUMNS =
  'id, device_code_hash, user_code, client_name, scope, status, user_id, api_key_id, key_ciphertext, created_at, expires_at, approved_at, consumed_at, last_polled_at, ip';

function fail(op: string, message: string): never {
  throw new Error(`device_authorizations ${op} failed: ${message}`);
}

export function createDeviceStore(admin: AdminClient = createAdminClient()): DeviceStore {
  const table = () => admin.from('device_authorizations');
  return {
    async insert(row) {
      const { data, error } = await table().insert(row).select(COLUMNS).single();
      if (error) {
        if (error.code === '23505') return { ok: false, conflict: true };
        console.error('[device-flow] insert failed:', error.message);
        return { ok: false, conflict: false };
      }
      return { ok: true, row: data as DeviceRow };
    },
    async findByDeviceCodeHash(hash) {
      const { data, error } = await table().select(COLUMNS).eq('device_code_hash', hash).maybeSingle();
      if (error) fail('select', error.message);
      return (data as DeviceRow | null) ?? null;
    },
    async findById(id) {
      const { data, error } = await table().select(COLUMNS).eq('id', id).maybeSingle();
      if (error) fail('select', error.message);
      return (data as DeviceRow | null) ?? null;
    },
    async findPendingByUserCode(userCode) {
      const { data, error } = await table()
        .select(COLUMNS)
        .eq('user_code', userCode)
        .eq('status', 'pending')
        .maybeSingle();
      if (error) fail('select', error.message);
      return (data as DeviceRow | null) ?? null;
    },
    async transition(id, from, patch, guard = {}) {
      let query = table().update(patch).eq('id', id).eq('status', from);
      if (guard.notExpiredAt) query = query.gt('expires_at', guard.notExpiredAt);
      if (guard.ciphertext === 'absent') query = query.is('key_ciphertext', null);
      if (guard.ciphertext === 'present') query = query.not('key_ciphertext', 'is', null);
      const { data, error } = await query.select(COLUMNS).maybeSingle();
      if (error) fail('update', error.message);
      return (data as DeviceRow | null) ?? null;
    },
    async touchPolled(id, at) {
      const { error } = await table().update({ last_polled_at: at }).eq('id', id);
      if (error) fail('update', error.message);
    },
    async revokeApiKey(keyId, at) {
      const { error } = await admin.from('api_keys').update({ revoked_at: at }).eq('id', keyId).is('revoked_at', null);
      if (error) console.error('[device-flow] revoking an uncollected key failed:', error.message);
    },
  };
}

/** Rows are kept this long past expiry (for support questions), then deleted. */
export const DEVICE_ROW_RETENTION_MS = 24 * 60 * 60 * 1000;

export interface DeviceCleanupResult {
  /** Approved requests that expired before the agent collected the key (key revoked). */
  expired_uncollected: number;
  deleted: number;
}

/**
 * For the hourly cron (app/api/cron/api-artifacts): revokes keys approved
 * for requests that expired uncollected, then deletes rows more than a day
 * past expiry. `dry` counts without changing anything.
 */
export async function cleanupDeviceAuthorizations(
  admin: AdminClient,
  now: Date,
  dry = false
): Promise<DeviceCleanupResult> {
  const nowIso = now.toISOString();
  const { data: stale, error } = await admin
    .from('device_authorizations')
    .select('id, api_key_id')
    .eq('status', 'approved')
    .lte('expires_at', nowIso)
    .limit(500);
  if (error) fail('select', error.message);
  const rows = stale ?? [];

  const cutoff = new Date(now.getTime() - DEVICE_ROW_RETENTION_MS).toISOString();
  if (dry) {
    const { count, error: countError } = await admin
      .from('device_authorizations')
      .select('id', { count: 'exact', head: true })
      .lte('expires_at', cutoff);
    if (countError) fail('count', countError.message);
    return { expired_uncollected: rows.length, deleted: count ?? 0 };
  }

  const store = createDeviceStore(admin);
  let expiredUncollected = 0;
  for (const row of rows) {
    const done = await store.transition(row.id, 'approved', { status: 'expired', key_ciphertext: null });
    if (!done) continue;
    expiredUncollected += 1;
  }
  // Every key id on an expired row belongs to a key that was never
  // delivered (delivered ones end `consumed`). Revoking them all here, not
  // per transition above, also retries a revoke that failed on an earlier
  // poll or run, and catches a key id stored after the row was read.
  const { data: undelivered, error: undeliveredError } = await admin
    .from('device_authorizations')
    .select('api_key_id')
    .eq('status', 'expired')
    .not('api_key_id', 'is', null)
    .limit(500);
  if (undeliveredError) fail('select', undeliveredError.message);
  const keyIds = (undelivered ?? []).map((r) => r.api_key_id).filter((id): id is string => Boolean(id));
  if (keyIds.length > 0) {
    const { error: revokeError } = await admin
      .from('api_keys')
      .update({ revoked_at: nowIso })
      .in('id', keyIds)
      .is('revoked_at', null);
    if (revokeError) fail('revoke', revokeError.message);
  }
  // Abandoned pending requests: free their user codes.
  const { error: pendingError } = await admin
    .from('device_authorizations')
    .update({ status: 'expired' })
    .eq('status', 'pending')
    .lte('expires_at', nowIso);
  if (pendingError) fail('update', pendingError.message);

  const { count, error: deleteError } = await admin
    .from('device_authorizations')
    .delete({ count: 'exact' })
    .lte('expires_at', cutoff);
  if (deleteError) fail('delete', deleteError.message);
  return { expired_uncollected: expiredUncollected, deleted: count ?? 0 };
}
