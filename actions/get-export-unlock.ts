'use server';

import { createClient } from '@/lib/supabase/server';
import { readExportUnlocked } from '@/lib/export-unlock';

/**
 * Whether the signed-in user bought the one-off export unlock for this
 * project (project_export_unlocks). Read with the user's own client: RLS
 * returns only their rows, so another user's project is always false.
 * False when signed out, when the migration is not applied yet, or on any
 * error.
 */
export async function getProjectExportUnlocked(projectId: string): Promise<boolean> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return false;
  return readExportUnlocked(supabase, projectId);
}
