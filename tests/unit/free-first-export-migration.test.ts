import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';

/**
 * supabase/migrations/20261108120000_free_first_export.sql: the guards the
 * free first export relies on. Checked against a real Postgres when the PR
 * was reviewed; this keeps them from being edited away.
 */
const sql = readFileSync(
  join(__dirname, '../../supabase/migrations/20261108120000_free_first_export.sql'),
  'utf8'
).toLowerCase();

describe('free first export migration', () => {
  it('keeps the free_first row when its project is deleted (no claim, delete, claim again)', () => {
    expect(sql).toMatch(/alter column project_id drop not null/);
    expect(sql).toMatch(/foreign key \(project_id\) references public\.projects\(id\) on delete set null/);
  });

  it('allows one free_first row per user', () => {
    expect(sql).toMatch(
      /create unique index if not exists project_export_unlocks_free_first_user_idx\s+on public\.project_export_unlocks \(user_id\)\s+where source = 'free_first'/
    );
  });

  it('opens no client write path: the claim rpc is service-role only, no insert policy', () => {
    expect(sql).toMatch(
      /revoke execute on function public\.claim_free_first_export\(uuid, uuid\) from public, anon, authenticated/
    );
    expect(sql).not.toMatch(/create policy/);
    expect(sql).not.toMatch(/grant (insert|all)[^;]*to authenticated/);
  });

  it('is idempotent and keeps existing rows as purchases', () => {
    expect(sql).toMatch(/add column if not exists source text/);
    expect(sql).toMatch(/set source = 'purchase' where source is null/);
  });
});
