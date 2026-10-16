'use server';

import { createClient } from '@/lib/supabase/server';

type UsageRecord = {
  onboarding_completed: boolean | null;
};

type UsageStatus = {
  is_pro: boolean | null;
  onboarding_completed: boolean | null;
};

export async function getCurrentUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return user;
}

export async function getUserUsage(
  userId: string
): Promise<UsageRecord | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('user_usage')
    .select('onboarding_completed')
    .eq('user_id', userId)
    .maybeSingle<UsageRecord>();

  return data;
}

export async function getUserUsageStatus(
  userId: string
): Promise<UsageStatus | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('user_usage')
    .select('is_pro, onboarding_completed')
    .eq('user_id', userId)
    .maybeSingle<UsageStatus>();

  return data;
}
