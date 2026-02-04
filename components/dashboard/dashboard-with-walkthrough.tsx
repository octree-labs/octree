'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import Navbar from '@/components/navbar';
import { CreateProjectDialog } from '@/components/projects/create-project-dialog';
import { ProjectsTable } from '@/components/projects/projects-table';
import { DashboardOnboarding } from '@/components/dashboard/dashboard-onboarding';
import { markDashboardWalkthroughSeen } from '@/lib/requests/walkthrough';
import type { Project } from '@/types/project';

interface DashboardWithWalkthroughProps {
  data: Project[];
  userName: string | null;
  userId: string;
  shouldShowWalkthrough: boolean;
}

export function DashboardWithWalkthrough({
  data,
  userName,
  userId,
  shouldShowWalkthrough,
}: DashboardWithWalkthroughProps) {
  const [walkthroughOpen, setWalkthroughOpen] = useState(false);
  const markedRef = useRef(false);

  useEffect(() => {
    if (shouldShowWalkthrough) {
      setWalkthroughOpen(true);
    }
  }, [shouldShowWalkthrough]);

  const handleWalkthroughComplete = useCallback(async () => {
    if (markedRef.current) return;
    markedRef.current = true;
    try {
      await markDashboardWalkthroughSeen(userId);
    } catch (error) {
      console.error('Failed to mark walkthrough as seen:', error);
    }
  }, [userId]);

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
        onComplete={handleWalkthroughComplete}
      />
    </>
  );
}
