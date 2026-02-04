import { createClient } from '@/lib/supabase/client';

export async function markDashboardWalkthroughSeen(userId: string) {
  const supabase = createClient();
  const { error } = await (supabase.from('user_walkthroughs') as any).upsert(
    {
      user_id: userId,
      dashboard_seen: true,
      dashboard_seen_at: new Date().toISOString(),
    },
    { onConflict: 'user_id' }
  );

  if (error) {
    throw error;
  }
}

export async function markGeneratedFirst(userId: string) {
  const supabase = createClient();
  const { error } = await (supabase.from('user_walkthroughs') as any).upsert(
    {
      user_id: userId,
      generated_first_at: new Date().toISOString(),
    },
    { onConflict: 'user_id' }
  );

  if (error) {
    throw error;
  }
}
