import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '@/database.types';

/**
 * The one-off export unlock (plan `export_single`): one row in
 * project_export_unlocks per unlocked project. Shared by the server action
 * (actions/get-export-unlock.ts) and the browser read
 * (lib/requests/export-unlock.ts); both run with the user's own client, so
 * RLS only ever returns the owner's row.
 *
 * The migration (supabase/migrations/20261021150000_project_export_unlocks.sql)
 * is applied by hand, so a missing table is "locked", never an error.
 */

/**
 * Postgres / PostgREST codes for a schema object the migration has not
 * created yet: an undefined table or column (42P01, PGRST205, 42703,
 * PGRST204, as lib/lifecycle/load.ts `isMissingLedgerSchema`) and an
 * undefined function (42883, PGRST202) for the webhook's RPC.
 */
const MISSING_EXPORT_SCHEMA_CODES: ReadonlySet<string> = new Set([
  '42P01',
  'PGRST205',
  '42703',
  'PGRST204',
  '42883',
  'PGRST202',
]);

export function isMissingExportUnlockSchema(error: { code?: string } | null | undefined): boolean {
  return !!error?.code && MISSING_EXPORT_SCHEMA_CODES.has(error.code);
}

/**
 * Whether `projectId` has an export unlock visible to this client. False on
 * a missing table and on any other read error (logged): export then stays
 * behind the paywall, exactly as it was before the unlock existed.
 */
export async function readExportUnlocked(
  supabase: Pick<SupabaseClient<Database>, 'from'>,
  projectId: string
): Promise<boolean> {
  try {
    const { data, error } = await supabase
      .from('project_export_unlocks')
      .select('id')
      .eq('project_id', projectId)
      .limit(1);
    if (error) {
      if (!isMissingExportUnlockSchema(error)) {
        console.error('[export-unlock] lookup failed:', error);
      }
      return false;
    }
    return (data?.length ?? 0) > 0;
  } catch (error) {
    console.error('[export-unlock] lookup failed:', error);
    return false;
  }
}
