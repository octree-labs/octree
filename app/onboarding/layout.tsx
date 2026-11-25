import { redirect } from 'next/navigation';

import { getCurrentUser, getUserUsageStatus } from '@/actions/get-user';
import { hasFinishedOnboarding } from '@/lib/onboarding/paywall-gate';

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

  if (hasFinishedOnboarding(usage)) {
    // Free or Pro, onboarded already (under the onboarding paywall, being Pro
    // counts too: the webhook's onboarding flag may lag the payment).
    redirect('/');
  }

  return <>{children}</>;
}
