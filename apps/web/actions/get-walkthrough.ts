'use server';

import { createClient } from '@/lib/supabase/server';

type WalkthroughStatus = {
  dashboard_seen: boolean | null;
  generate_seen: boolean | null;
  editor_seen: boolean | null;
  generated_first_at: string | null;
};

export async function getUserWalkthroughStatus(
  userId: string
): Promise<WalkthroughStatus | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('user_walkthroughs')
    .select('dashboard_seen, generate_seen, editor_seen, generated_first_at')
    .eq('user_id', userId)
    .maybeSingle<WalkthroughStatus>();

  return data;
}
