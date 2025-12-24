import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { CreateProjectDialog } from '@/components/projects/create-project-dialog';
import { ProjectsTable } from '@/components/projects/projects-table';
import Navbar from '@/components/navbar';
import { getAllProjects } from '@/actions/get-projects';
import { getUserUsage } from '@/lib/requests/user';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Sparkles } from 'lucide-react';

export default async function Dashboard() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect('/auth/login');
  }

  const usage = await getUserUsage(supabase, user.id);

  if (!usage?.onboarding_completed) {
    redirect('/onboarding');
  }

  const userName = user?.user_metadata?.name ?? user?.email ?? null;

  const data = await getAllProjects();

  if (!data) {
    return <div>No data</div>;
  }

  return (
    <>
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
            <Button asChild variant="outline" size="sm">
              <Link href="/generate">
                <Sparkles className="mr-2 h-4 w-4" />
                Generate
              </Link>
            </Button>
            <CreateProjectDialog />
          </div>
        </div>

        <ProjectsTable data={data} />
      </main>
    </>
  );
}
