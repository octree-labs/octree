import { redirect } from 'next/navigation';

import { getCurrentUser, getUserUsageStatus } from '@/actions/get-user';
import { hasFinishedOnboarding, onboardingPaywallApplies } from '@/lib/onboarding/paywall-gate';

interface OnboardingLayoutProps {
  children: React.ReactNode;
}

export default async function OnboardingLayout({
  children,
}: OnboardingLayoutProps) {
  const user = await getCurrentUser();

  if (!user) {
    redirect('/auth/login');
  }

  const usage = await getUserUsageStatus(user.id);

  // Same rule as the dashboard (app/page.tsx), so the two never bounce.
  if (hasFinishedOnboarding(usage, onboardingPaywallApplies(user.created_at))) {
    // Free or Pro, onboarded already (under the onboarding paywall, being Pro
    // counts too: the webhook's onboarding flag may lag the payment).
    redirect('/');
  }

  return <>{children}</>;
}
