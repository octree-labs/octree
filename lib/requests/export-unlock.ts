import { createClient } from '@/lib/supabase/client';
import { readExportUnlocked } from '@/lib/export-unlock';

/**
 * Browser read of the one-off export unlock for a project, with the user's
 * own Supabase client (RLS: owner only). Used to poll after returning from
 * Stripe while the webhook catches up. False on any error.
 */
export async function fetchProjectExportUnlocked(projectId: string): Promise<boolean> {
  return readExportUnlocked(createClient(), projectId);
}
