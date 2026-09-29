'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { flushSync } from 'react-dom';
import { Search } from 'lucide-react';
import { Sparkles } from '@/components/icons/sparkles';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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
  generateWalkthroughCompleted?: boolean;
}

export function DashboardWithWalkthrough({
  data,
  userName,
  userId,
  shouldShowWalkthrough,
  generateWalkthroughCompleted = false,
}: DashboardWithWalkthroughProps) {
  const router = useRouter();
  const [walkthroughOpen, setWalkthroughOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const markedRef = useRef(false);

  const handleGenerateClick = useCallback(
    (e: React.MouseEvent) => {
      if (walkthroughOpen) {
        e.preventDefault();
        flushSync(() => setWalkthroughOpen(false));
        router.push('/generate');
      }
    },
    [walkthroughOpen, router]
  );

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

      <main className="container mx-auto min-h-0 px-4 py-8">
        <div
          className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between"
          data-onboarding-target="dashboard-header"
        >
          <div>
            <h1 className="text-lg font-semibold text-neutral-900">Projects</h1>
            <p className="text-sm text-neutral-500">
              Manage and edit your projects
            </p>
          </div>

          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <div className="relative w-full sm:w-64">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" />
              <Input
                type="text"
                placeholder="Search projects..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-10"
              />
            </div>
            <span data-onboarding-target="dashboard-generate-button">
              <Link
                href="/generate"
                onClick={handleGenerateClick}
              >
                <Button variant="outline-gradient" size="sm">
                  <Sparkles className="h-4 w-4 text-primary" />
                  Generate with AI
                </Button>
              </Link>
            </span>
            <span data-onboarding-target="dashboard-new-project">
              <CreateProjectDialog />
            </span>
          </div>
        </div>

        <div data-onboarding-target="dashboard-projects">
          <ProjectsTable data={data} searchQuery={searchQuery} />
        </div>
      </main>

      <DashboardOnboarding
        open={walkthroughOpen}
        onOpenChange={handleWalkthroughClose}
        onComplete={handleWalkthroughComplete}
        initialStep={generateWalkthroughCompleted ? 1 : 0}
      />
    </>
  );
}
