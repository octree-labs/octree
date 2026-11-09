import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';

/** supabase/migrations/20261109000000_api_keys.sql: the guards the API relies on. */
const sql = readFileSync(join(__dirname, '../../supabase/migrations/20261109000000_api_keys.sql'), 'utf8').toLowerCase();

describe('api keys migration', () => {
  it('is idempotent', () => {
    expect(sql).toMatch(/create table if not exists public\.api_keys/);
    expect(sql).toMatch(/create table if not exists public\.api_usage_daily/);
    for (const name of ['api_keys_select_own', 'api_keys_insert_own', 'api_keys_update_own']) {
      expect(sql).toContain(`drop policy if exists "${name}"`);
    }
  });

  it('stores only a unique sha256 hash and cascades on user delete', () => {
    expect(sql).toMatch(/user_id uuid not null references auth\.users\(id\) on delete cascade/);
    expect(sql).toMatch(/create unique index if not exists api_keys_key_hash_key on public\.api_keys \(key_hash\)/);
    expect(sql).toMatch(/key_hash ~ '\^\[0-9a-f\]\{64\}\$'/);
  });

  it('never lets users read the hash or change anything but name/revoked_at', () => {
    expect(sql).toMatch(/revoke all on public\.api_keys from anon, authenticated/);
    expect(sql).toMatch(/grant select \(id, user_id, name, key_prefix, created_at, last_used_at, revoked_at\)/);
    expect(sql).toMatch(/grant update \(name, revoked_at\) on public\.api_keys to authenticated/);
  });

  it('caps active keys at 5 and keeps revoked keys revoked', () => {
    expect(sql).toMatch(/>= 5 then/);
    expect(sql).toMatch(/api key is already revoked/);
  });

  it('keeps usage service-role only with an atomic increment', () => {
    expect(sql).toMatch(/revoke all on public\.api_usage_daily from anon, authenticated/);
    expect(sql).toMatch(/on conflict \(user_id, day\) do update set compiles = u\.compiles \+ 1/);
    expect(sql).toMatch(/revoke execute on function public\.increment_api_usage\(uuid, date\) from public, anon, authenticated/);
    expect(sql).toMatch(/grant execute on function public\.increment_api_usage\(uuid, date\) to service_role/);
  });

  it('does not touch user_usage', () => {
    expect(sql).not.toMatch(/alter table public\.user_usage|on public\.user_usage/);
  });
});
