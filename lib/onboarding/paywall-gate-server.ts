import { redirect } from 'next/navigation';

import { createClient } from '@/lib/supabase/server';
import {
  onboardingPaywallApplies,
  onboardingPath,
  shouldRedirectToOnboarding,
} from '@/lib/onboarding/paywall-gate';

/**
 * For the editor and /generate layouts: under the onboarding paywall, a user
 * who has not finished onboarding (and is not Pro) goes to /onboarding,
 * which brings them back to `next` after checkout. A no-op (and no query)
 * with the paywall off, or for an account older than the paywall
 * (ONBOARDING_PAYWALL_SINCE).
 */
export async function enforceOnboardingPaywall(
  user: { id: string; created_at?: string | null },
  next: string
): Promise<void> {
  const paywallRequired = onboardingPaywallApplies(user.created_at);
  if (!paywallRequired) return;
  const supabase = await createClient();
  const { data: usage, error } = await supabase
    .from('user_usage')
    .select('is_pro, onboarding_completed, pro_until')
    .eq('user_id', user.id)
    .maybeSingle<{ is_pro: boolean | null; onboarding_completed: boolean | null; pro_until: string | null }>();
  // A failed read is not a new user: let them through rather than show a paying
  // customer the plan step (where they could start a second checkout).
  if (error) {
    console.error('onboarding paywall: user_usage read failed', error.message);
    return;
  }
  if (shouldRedirectToOnboarding(usage, 'app', paywallRequired)) {
    redirect(onboardingPath(next));
  }
}
