import { redirect } from 'next/navigation';
import Link from 'next/link';
import { Sparkles } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { Button } from '@/components/ui/button';
import { CreateProjectDialog } from '@/components/projects/create-project-dialog';
import { ProjectsTable } from '@/components/projects/projects-table';
import Navbar from '@/components/navbar';
import { getAllProjects } from '@/actions/get-projects';
import { getUserUsageStatus } from '@/actions/get-user';
import { PaywallDialog } from '@/components/subscription/paywall-dialog';

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
        <div className="mb-8 flex items-center justify-between">
          <div>
            <h1 className="text-lg font-semibold text-neutral-900">Projects</h1>
            <p className="text-sm text-neutral-500">
              Manage and edit your projects
            </p>
          </div>

          <div className="flex items-center gap-2">
            <Link href="/generate">
              <Button variant="outline" size="sm">
                <Sparkles className="mr-2 h-4 w-4" />
                Generate with AI
              </Button>
            </Link>
            <CreateProjectDialog />
          </div>
        </div>

        <ProjectsTable data={data} />
      </main>
    </>
  );
}
