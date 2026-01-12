import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { ProjectsTable } from '@/components/projects/projects-table';
import Navbar from '@/components/navbar';
import { getAllProjects } from '@/actions/get-projects';
import { getUserUsageStatus } from '@/actions/get-user';
import { PaywallDialog } from '@/components/subscription/paywall-dialog';
import { DashboardActions } from '@/components/dashboard/dashboard-actions';

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

  // Show paywall if user has completed onboarding but is not pro
  const showPaywall = usage.onboarding_completed && !usage.is_pro;

  const userName = user?.user_metadata?.name ?? user?.email ?? null;

  const data = await getAllProjects();

  if (!data) {
    return <div>No data</div>;
  }

  return (
    <>
      {showPaywall && <PaywallDialog userEmail={user.email!} />}

      <Navbar userName={userName} />

      <main className="container mx-auto px-4 py-8">
        <div className="mb-8">
          <h1 className="text-lg font-semibold text-neutral-900">
            Projects
          </h1>
          <p className="text-sm text-neutral-500">
            Manage and edit your projects
          </p>
        </div>

        <div className="mb-8">
          <DashboardActions />
        </div>

        <ProjectsTable data={data} />
      </main>
    </>
  );
}

