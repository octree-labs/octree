'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { flushSync } from 'react-dom';
import { ArrowRight, FileText, Search } from 'lucide-react';
import { Sparkles } from '@/components/icons/sparkles';
import { Badge } from '@/components/ui/badge';
import { primaryClasses } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import Navbar from '@/components/navbar';
import { CreateProjectDialog } from '@/components/projects/create-project-dialog';
import { ProjectsTable } from '@/components/projects/projects-table';
import { DashboardOnboarding } from '@/components/dashboard/dashboard-onboarding';
import { StartWithDocument } from '@/components/onboarding/start-with-document';
import { ResumeRedesignDialog } from '@/components/resume/resume-redesign-dialog';
import { markDashboardWalkthroughSeen } from '@/lib/requests/walkthrough';
import { cn } from '@/lib/utils';
import type { Project } from '@/types/project';

function ActionCard({
  href,
  onClick,
  icon,
  title,
  description,
  isNew = false,
}: {
  href?: string;
  onClick?: (e: React.MouseEvent) => void;
  icon: React.ReactNode;
  title: string;
  description: string;
  isNew?: boolean;
}) {
  const className =
    'relative flex h-full items-center gap-3 rounded-lg border border-neutral-300 bg-card px-4 py-3 transition-shadow hover:shadow-md';
  const content = (
    <>
      {isNew && (
        <Badge
          className={cn(
            primaryClasses,
            'absolute -top-2 right-3 rounded-sm px-1.5 py-0 text-[10px] leading-4 shadow-sm'
          )}
        >
          New
        </Badge>
      )}
      {icon}
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-neutral-900">{title}</p>
        <p className="truncate text-xs text-neutral-500">{description}</p>
      </div>
      <ArrowRight className="size-4 shrink-0 text-neutral-400" />
    </>
  );

  if (!href) {
    return (
      <button type="button" onClick={onClick} className={cn(className, 'w-full text-left')}>
        {content}
      </button>
    );
  }

  return (
    <Link href={href} onClick={onClick} className={className}>
      {content}
    </Link>
  );
}

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
  const [resumeDialogOpen, setResumeDialogOpen] = useState(false);
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

  const isEmpty = data.length === 0;

  return (
    <>
      <Navbar userName={userName} />

      <main className="container mx-auto min-h-0 px-4 py-8">
        {isEmpty ? (
          // First session: the user's own document is the default path. The
          // walkthrough targets are kept so its spotlight still lands.
          <div className="mx-auto max-w-2xl">
            <div className="mb-6" data-onboarding-target="dashboard-header">
              <h1 className="text-xl font-semibold text-neutral-900">Start with your document</h1>
              <p className="text-sm text-neutral-500">
                Bring the LaTeX you are already working on. It opens in the editor and compiles
                right away.
              </p>
            </div>
            <div data-onboarding-target="dashboard-projects">
              <StartWithDocument
                context="dashboard"
                targets={{
                  blank: 'dashboard-new-project',
                  generate: 'dashboard-generate-button',
                }}
              />
            </div>
            <p className="mt-6 text-xs text-neutral-500">
              Have a resume as a PDF?{' '}
              <button
                type="button"
                onClick={() => setResumeDialogOpen(true)}
                className="font-medium text-primary underline-offset-4 hover:underline"
              >
                Redesign it into LaTeX
              </button>
            </p>
          </div>
        ) : (
          <>
            <div className="mb-8 grid gap-3 sm:grid-cols-2 lg:max-w-3xl">
              <div data-onboarding-target="dashboard-generate-button">
                <ActionCard
                  href="/generate"
                  onClick={handleGenerateClick}
                  icon={<Sparkles className="h-4 w-4 shrink-0 text-primary" />}
                  title="Generate with AI"
                  description="Describe a document and get a compiled LaTeX draft"
                />
              </div>
              <ActionCard
                onClick={() => setResumeDialogOpen(true)}
                icon={<FileText className="size-4 shrink-0 text-neutral-500" />}
                title="Redesign your resume"
                description="Upload a PDF and get a clean, editable LaTeX version"
                isNew
              />
            </div>

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
                <span data-onboarding-target="dashboard-new-project" className="flex items-center gap-2">
                  <CreateProjectDialog mode="import" />
                  <CreateProjectDialog />
                </span>
              </div>
            </div>

            <div data-onboarding-target="dashboard-projects">
              <ProjectsTable data={data} searchQuery={searchQuery} />
            </div>
          </>
        )}
      </main>

      <ResumeRedesignDialog
        open={resumeDialogOpen}
        onOpenChange={setResumeDialogOpen}
      />

      <DashboardOnboarding
        open={walkthroughOpen}
        onOpenChange={handleWalkthroughClose}
        onComplete={handleWalkthroughComplete}
        initialStep={generateWalkthroughCompleted ? 1 : 0}
      />
    </>
  );
}
