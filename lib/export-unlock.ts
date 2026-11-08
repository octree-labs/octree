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
 * The checkout route's 409 for an `export_single` on a project that is
 * already unlocked (the paywall dialog recognises it and closes).
 */
export const EXPORT_ALREADY_UNLOCKED_MESSAGE = 'Export is already unlocked for this project';

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

/** project_export_unlocks.source of the free first export (migration 20261108120000). */
export const FREE_FIRST_EXPORT_SOURCE = 'free_first';

/**
 * Whether the user already used the free first export (a `free_first`
 * unlock row). Pass the service-role client, or the user's own (RLS returns
 * their rows). Null when it cannot be told: the migration is not applied
 * (no `source` column) or the read failed; the caller then offers nothing.
 */
export async function readFreeFirstExportUsed(
  supabase: Pick<SupabaseClient<Database>, 'from'>,
  userId: string
): Promise<boolean | null> {
  try {
    const { data, error } = await supabase
      .from('project_export_unlocks')
      .select('id')
      .eq('user_id', userId)
      .eq('source', FREE_FIRST_EXPORT_SOURCE)
      .limit(1);
    if (error) {
      if (!isMissingExportUnlockSchema(error)) {
        console.error('[export-unlock] free export lookup failed:', error);
      }
      return null;
    }
    return (data?.length ?? 0) > 0;
  } catch (error) {
    console.error('[export-unlock] free export lookup failed:', error);
    return null;
  }
}

/** What `claim_free_first_export` answers (see the migration). */
export type FreeExportClaimRpcResult = 'granted' | 'already_unlocked' | 'used' | 'not_found';

/**
 * The server action's answer to the toolbar (actions/claim-free-export.ts):
 * - `granted`    - free export used on this project now: export, show the note;
 * - `unlocked`   - this project was already unlocked, or the user is
 *                  entitled: export, no note;
 * - `used`       - the free export is spent: paywall (`free_export_used`);
 * - `unavailable`- switched off, not signed in, not their project, migration
 *                  missing, or an error: paywall as before (`pro_feature`).
 */
export type FreeExportClaimStatus = 'granted' | 'unlocked' | 'used' | 'unavailable';

export function freeExportClaimStatus(rpcResult: unknown): FreeExportClaimStatus {
  switch (rpcResult) {
    case 'granted':
      return 'granted';
    case 'already_unlocked':
      return 'unlocked';
    case 'used':
      return 'used';
    default:
      return 'unavailable';
  }
}
