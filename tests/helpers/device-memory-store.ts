import { randomUUID } from 'node:crypto';
import type { DeviceRow, DeviceStore } from '@/lib/device/flow';

/** An in-memory DeviceStore with the same conditional-update semantics as lib/device/store.ts. */
export function createMemoryDeviceStore() {
  const rows = new Map<string, DeviceRow>();
  const revoked: string[] = [];
  let createdAt = new Date('2026-11-25T12:00:00Z').toISOString();

  const store: DeviceStore = {
    async insert(row) {
      for (const existing of rows.values()) {
        if (existing.user_code === row.user_code && (existing.status === 'pending' || existing.status === 'approved')) {
          return { ok: false, conflict: true };
        }
      }
      const full: DeviceRow = {
        id: randomUUID(),
        device_code_hash: row.device_code_hash,
        user_code: row.user_code,
        client_name: row.client_name,
        scope: row.scope,
        status: 'pending',
        user_id: null,
        api_key_id: null,
        key_ciphertext: null,
        created_at: createdAt,
        expires_at: row.expires_at,
        approved_at: null,
        consumed_at: null,
        last_polled_at: null,
      };
      rows.set(full.id, full);
      return { ok: true, row: { ...full } };
    },
    async findByDeviceCodeHash(hash) {
      for (const row of rows.values()) if (row.device_code_hash === hash) return { ...row };
      return null;
    },
    async findById(id) {
      const row = rows.get(id);
      return row ? { ...row } : null;
    },
    async findPendingByUserCode(code) {
      for (const row of rows.values()) if (row.user_code === code && row.status === 'pending') return { ...row };
      return null;
    },
    async transition(id, from, patch, guard = {}) {
      const row = rows.get(id);
      if (!row || row.status !== from) return null;
      if (guard.notExpiredAt && !(Date.parse(row.expires_at) > Date.parse(guard.notExpiredAt))) return null;
      if (guard.ciphertext === 'absent' && row.key_ciphertext !== null) return null;
      if (guard.ciphertext === 'present' && row.key_ciphertext === null) return null;
      Object.assign(row, patch);
      return { ...row };
    },
    async touchPolled(id, at) {
      const row = rows.get(id);
      if (row) row.last_polled_at = at;
    },
    async revokeApiKey(keyId) {
      revoked.push(keyId);
    },
  };

  return {
    store,
    rows,
    revoked,
    setCreatedAt(value: string) {
      createdAt = value;
    },
    only(): DeviceRow {
      const all = [...rows.values()];
      if (all.length !== 1) throw new Error(`expected one row, have ${all.length}`);
      return all[0];
    },
  };
}
