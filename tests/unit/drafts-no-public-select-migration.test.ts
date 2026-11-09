import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';

/**
 * supabase/migrations/20261109140000_drafts_no_public_select.sql: drafts are
 * capability-based (whoever has the uuid opens that one draft through a
 * server route), so the public key must not be able to list, insert, update
 * or delete them. Keeps the revokes from being edited away.
 */
const sql = readFileSync(
  join(__dirname, '../../supabase/migrations/20261109140000_drafts_no_public_select.sql'),
  'utf8'
)
  .toLowerCase()
  .split('\n')
  .filter((line) => !line.trimStart().startsWith('--'))
  .join('\n');

describe('drafts no public select migration', () => {
  it('drops every policy that let anon or authenticated reach drafts', () => {
    for (const policy of ['drafts_select_any', 'drafts_insert_any', 'drafts_delete_any', 'drafts_update_consume']) {
      expect(sql).toContain(`drop policy if exists ${policy} on public.drafts`);
    }
    expect(sql).not.toMatch(/create policy/);
  });

  it('revokes every privilege from anon and authenticated, including the column-level update grant', () => {
    expect(sql).toMatch(/revoke all on table public\.drafts from anon, authenticated/);
    expect(sql).toMatch(
      /revoke update \(consumed_at, consumed_by, project_id\) on public\.drafts from anon, authenticated/
    );
    expect(sql).not.toMatch(/grant [^;]* to [^;]*\b(anon|authenticated)\b/);
  });

  it('keeps RLS on and the service role working', () => {
    expect(sql).toMatch(/alter table public\.drafts enable row level security/);
    expect(sql).toMatch(/grant all on table public\.drafts to service_role/);
  });
});
