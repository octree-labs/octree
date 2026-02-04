import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getAllProjects } from '@/actions/get-projects';
import { getUserUsageStatus } from '@/actions/get-user';
import { getUserWalkthroughStatus } from '@/actions/get-walkthrough';
import { DashboardWithWalkthrough } from '@/components/dashboard/dashboard-with-walkthrough';

export default async function Dashboard() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect('/auth/login');
  }

  const usage = await getUserUsageStatus(user.id);

  if (!usage?.onboarding_completed) {
    redirect('/onboarding');
  }

  const userName = user?.user_metadata?.name ?? user?.email ?? null;

  const data = await getAllProjects();
  const walkthroughStatus = await getUserWalkthroughStatus(user.id);
  const shouldShowWalkthrough = !walkthroughStatus?.dashboard_seen;

  if (!data) {
    return <div>No data</div>;
  }

  return (
    <DashboardWithWalkthrough
      data={data}
      userName={userName}
      userId={user.id}
      shouldShowWalkthrough={shouldShowWalkthrough}
    />
  );
}
