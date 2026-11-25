import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';

/**
 * supabase/migrations/20261125000000_storage_project_ownership.sql: storage
 * access under octree/projects/ and chat-attachments/ is limited to the
 * owner. Keeps the old any-user policies from coming back and every new
 * policy carrying its ownership check.
 */
const sql = readFileSync(
  join(__dirname, '../../supabase/migrations/20261125000000_storage_project_ownership.sql'),
  'utf8'
)
  .split('\n')
  .filter((line) => !line.trimStart().startsWith('--'))
  .join('\n');

const policies = [...sql.matchAll(/create policy "([^"]+)" on storage\.objects([\s\S]*?);/g)].map(
  ([, name, body]) => ({ name, body })
);

describe('storage ownership migration', () => {
  it('drops the four any-user octree policies and the open chat-attachments ones', () => {
    for (const n of [0, 1, 2, 3]) {
      expect(sql).toContain(
        `drop policy if exists "Allow authenticated users to access files 1i4k60i_${n}" on storage.objects;`
      );
    }
    expect(sql).toContain('drop policy if exists "Allow authenticated upload to chat-attachments" on storage.objects;');
    expect(sql).toContain('drop policy if exists "Allow public read on chat-attachments" on storage.objects;');
  });

  it('drops every policy it creates first, so it can be re-run', () => {
    expect(policies.length).toBe(6);
    for (const { name } of policies) {
      expect(sql).toContain(`drop policy if exists "${name}" on storage.objects;`);
    }
  });

  it('scopes every octree projects/ policy to a project the caller owns', () => {
    const octree = policies.filter((p) => p.body.includes("bucket_id = 'octree'"));
    expect(octree.map((p) => p.body.match(/for (\w+)/)?.[1]).sort()).toEqual([
      'delete',
      'insert',
      'select',
      'update',
    ]);
    for (const { body } of octree) {
      expect(body).toMatch(/to authenticated/);
      const checks = body.match(/exists \(\s*select 1 from public\.projects p/g) ?? [];
      // update checks both the existing row and the new name.
      expect(checks.length).toBe(body.includes('for update') ? 2 : 1);
      expect(body).toContain('p.user_id = (select auth.uid())');
      expect(body).toContain("(storage.foldername(name))[2] = '_previews'");
    }
  });

  it('scopes chat-attachments insert and select to the caller folder', () => {
    const chat = policies.filter((p) => p.body.includes("bucket_id = 'chat-attachments'"));
    expect(chat.length).toBe(2);
    for (const { body } of chat) {
      expect(body).toMatch(/to authenticated/);
      expect(body).toContain('(storage.foldername(name))[1] = (select auth.uid())::text');
    }
    expect(sql).not.toMatch(/to public/);
  });

  it('indexes projects.user_id for the ownership lookup', () => {
    expect(sql).toContain('create index if not exists projects_user_id_idx on public.projects (user_id);');
  });
});
