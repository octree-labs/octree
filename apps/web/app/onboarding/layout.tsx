import { redirect } from 'next/navigation';

import { getCurrentUser, getUserUsage } from '@/actions/get-user';

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

  const usage = await getUserUsage(user.id);

  if (usage?.onboarding_completed) {
    redirect('/');
  }

  return <>{children}</>;
}

