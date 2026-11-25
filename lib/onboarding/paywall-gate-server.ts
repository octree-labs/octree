import { redirect } from 'next/navigation';

import { getUserUsageStatus } from '@/actions/get-user';
import { ONBOARDING_PAYWALL_REQUIRED } from '@/data/constants';
import { onboardingPath, shouldRedirectToOnboarding } from '@/lib/onboarding/paywall-gate';

/**
 * For the editor and /generate layouts: under the onboarding paywall, a user
 * who has not finished onboarding (and is not Pro) goes to /onboarding,
 * which brings them back to `next` after checkout. A no-op (and no query)
 * with the paywall off.
 */
export async function enforceOnboardingPaywall(userId: string, next: string): Promise<void> {
  if (!ONBOARDING_PAYWALL_REQUIRED) return;
  const usage = await getUserUsageStatus(userId);
  if (shouldRedirectToOnboarding(usage, 'app')) {
    redirect(onboardingPath(next));
  }
}
