import { Suspense } from 'react';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { PENDING_DRAFT_COOKIE, isDraftId } from '@/lib/import/pending-draft';
import { getAllProjects } from '@/actions/get-projects';
import { getUserUsageStatus } from '@/actions/get-user';
import { getUserWalkthroughStatus } from '@/actions/get-walkthrough';
import { DashboardWithWalkthrough } from '@/components/dashboard/dashboard-with-walkthrough';
import { PaywallDialog } from '@/components/subscription/paywall-dialog';
import { UpgradeParam } from '@/components/lifecycle/upgrade-param';

export default async function Dashboard() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect('/auth/login');
  }

  // A draft from tools.useoctree.com is waiting (e.g. the visitor logged in
  // via a path that dropped `next`): finish the import. The import route
  // clears the cookie on every exit, so this cannot loop.
  const cookieStore = await cookies();
  if (isDraftId(cookieStore.get(PENDING_DRAFT_COOKIE)?.value)) {
    redirect('/import');
  }

  const usage = await getUserUsageStatus(user.id);

  if (!usage?.onboarding_completed) {
    redirect('/onboarding');
  }

  const userName = user?.user_metadata?.name ?? user?.email ?? null;

  const data = await getAllProjects();
  const walkthroughStatus = await getUserWalkthroughStatus(user.id);
  const shouldShowWalkthrough = !walkthroughStatus?.dashboard_seen;
  const generateWalkthroughCompleted = !!walkthroughStatus?.generate_seen;

  if (!data) {
    return <div>No data</div>;
  }

  return (
    <>
      {/* `?upgrade=1` from the lifecycle emails opens the paywall here. */}
      <Suspense fallback={null}>
        <UpgradeParam />
      </Suspense>
      <PaywallDialog />
      <DashboardWithWalkthrough
        data={data}
        userName={userName}
        userId={user.id}
        shouldShowWalkthrough={shouldShowWalkthrough}
        generateWalkthroughCompleted={generateWalkthroughCompleted}
      />
    </>
  );
}
