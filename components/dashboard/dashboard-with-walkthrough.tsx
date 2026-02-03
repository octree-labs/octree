'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import Navbar from '@/components/navbar';
import { CreateProjectDialog } from '@/components/projects/create-project-dialog';
import { ProjectsTable } from '@/components/projects/projects-table';
import { DashboardOnboarding } from '@/components/dashboard/dashboard-onboarding';
import type { Project } from '@/types/project';

interface DashboardWithWalkthroughProps {
  data: Project[];
  userName: string | null;
}

export function DashboardWithWalkthrough({
  data,
  userName,
}: DashboardWithWalkthroughProps) {
  const [walkthroughOpen, setWalkthroughOpen] = useState(false);

  useEffect(() => {
    setWalkthroughOpen(true);
  }, []);

  const handleWalkthroughClose = (open: boolean) => {
    setWalkthroughOpen(open);
  };

  return (
    <>
      <Navbar userName={userName} />

      <main className="container mx-auto px-4 py-8">
        <div
          className="mb-8 flex items-center justify-between"
          data-onboarding-target="dashboard-header"
        >
          <div>
            <h1 className="text-lg font-semibold text-neutral-900">Projects</h1>
            <p className="text-sm text-neutral-500">
              Manage and edit your projects
            </p>
          </div>

          <div className="flex items-center gap-2" data-onboarding-target="dashboard-actions">
            <Link href="/generate">
              <Button variant="outline-gradient" size="sm">
                <Sparkles className="h-4 w-4" />
                Generate with AI
              </Button>
            </Link>
            <CreateProjectDialog />
          </div>
        </div>

        <div data-onboarding-target="dashboard-projects">
          <ProjectsTable data={data} />
        </div>
      </main>

      <DashboardOnboarding
        open={walkthroughOpen}
        onOpenChange={handleWalkthroughClose}
      />
    </>
  );
}
