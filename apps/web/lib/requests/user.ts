import { createClient } from '@/lib/supabase/client';

type UsageStatus = {
  is_pro: boolean | null;
  onboarding_completed: boolean | null;
};

export const getUserUsageStatus = async (
  userId: string
): Promise<UsageStatus | null> => {
  const supabase = createClient();
  const { data } = await supabase
    .from('user_usage')
    .select('is_pro, onboarding_completed')
    .eq('user_id', userId)
    .maybeSingle<UsageStatus>();

  return data;
};

export const upsertUserUsage = async (
  userId: string,
  data: {
    referral_source?: string;
    role?: string;
    use_case?: string;
    onboarding_completed?: boolean;
  }
): Promise<void> => {
  const supabase = createClient();

  const { error } = await (supabase.from('user_usage') as any).upsert(
    { user_id: userId, ...data },
    { onConflict: 'user_id' }
  );

  if (error) {
    throw new Error('Failed to save user data');
  }
};
