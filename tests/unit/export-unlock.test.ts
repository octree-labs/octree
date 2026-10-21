import { describe, it, expect, vi } from 'vitest';

import { isMissingExportUnlockSchema, readExportUnlocked } from '@/lib/export-unlock';

function client(result: { data: unknown; error: unknown } | Error) {
  const limit = vi.fn(() => (result instanceof Error ? Promise.reject(result) : Promise.resolve(result)));
  const eq = vi.fn(() => ({ limit }));
  const select = vi.fn(() => ({ eq }));
  const from = vi.fn(() => ({ select }));
  return { supabase: { from } as any, from, eq };
}

describe('readExportUnlocked', () => {
  const projectId = '2f1c7d4e-8a9b-4c3d-9e2f-1a2b3c4d5e6f';

  it('is true when the (RLS-scoped) row exists', async () => {
    const { supabase, from, eq } = client({ data: [{ id: 'u1' }], error: null });
    await expect(readExportUnlocked(supabase, projectId)).resolves.toBe(true);
    expect(from).toHaveBeenCalledWith('project_export_unlocks');
    expect(eq).toHaveBeenCalledWith('project_id', projectId);
  });

  it('is false without a row', async () => {
    await expect(readExportUnlocked(client({ data: [], error: null }).supabase, projectId)).resolves.toBe(false);
  });

  it.each(['42P01', 'PGRST205', 'PGRST204'])('is false, silently, while the migration is pending (%s)', async (code) => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(readExportUnlocked(client({ data: null, error: { code } }).supabase, projectId)).resolves.toBe(false);
    expect(error).not.toHaveBeenCalled();
    error.mockRestore();
  });

  it('is false (logged) on any other error or a throw', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(readExportUnlocked(client({ data: null, error: { code: '08006' } }).supabase, projectId)).resolves.toBe(false);
    await expect(readExportUnlocked(client(new Error('network')).supabase, projectId)).resolves.toBe(false);
    expect(error).toHaveBeenCalledTimes(2);
    error.mockRestore();
  });
});

describe('isMissingExportUnlockSchema', () => {
  it('knows the table, column and function codes', () => {
    for (const code of ['42P01', 'PGRST205', '42703', 'PGRST204', '42883', 'PGRST202']) {
      expect(isMissingExportUnlockSchema({ code })).toBe(true);
    }
    expect(isMissingExportUnlockSchema({ code: '23505' })).toBe(false);
    expect(isMissingExportUnlockSchema(null)).toBe(false);
  });
});
