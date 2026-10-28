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
        <p className="line-clamp-2 text-xs text-neutral-500">{description}</p>
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
  userId: string;
  shouldShowWalkthrough: boolean;
  generateWalkthroughCompleted?: boolean;
}

export function DashboardWithWalkthrough({
  data,
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
        router.push('/generate?from=dashboard');
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
      {isEmpty ? (
        // First session: the user's own document is the default path. The
        // walkthrough targets are kept so its spotlight still lands.
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="container mx-auto px-4 py-8">
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
            </div>
          </div>
        </div>
      ) : (
        <div className="container mx-auto flex min-h-0 flex-1 flex-col px-4 pt-8">
          {/* Columns follow the space left by the sidebar, not the window width. */}
          <div className="mb-8 grid max-w-3xl grid-cols-[repeat(auto-fit,minmax(16rem,1fr))] gap-3">
            <div data-onboarding-target="dashboard-generate-button">
              <ActionCard
                href="/generate?from=dashboard"
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

          {/* The controls drop below the title when they don't fit beside it. */}
          <div
            className="mb-6 flex flex-wrap items-center justify-between gap-x-6 gap-y-3"
            data-onboarding-target="dashboard-header"
          >
            <div className="shrink-0">
              <h1 className="text-lg font-semibold text-neutral-900">Projects</h1>
              <p className="text-sm text-neutral-500">
                Manage and edit your projects
              </p>
            </div>

            <div className="flex grow flex-wrap items-center justify-end gap-2">
              <div className="relative min-w-40 max-w-xs flex-1 basis-64">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" />
                <Input
                  type="text"
                  placeholder="Search projects..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-10"
                />
              </div>
              <span data-onboarding-target="dashboard-new-project" className="flex shrink-0 items-center gap-2">
                <CreateProjectDialog mode="import" />
                <CreateProjectDialog />
              </span>
            </div>
          </div>

          {/* Fills the rest of the screen; ProjectGrid scrolls the cards and pins
              the pagination row to the bottom. */}
          <div data-onboarding-target="dashboard-projects" className="flex min-h-0 flex-1 flex-col">
            <ProjectsTable data={data} searchQuery={searchQuery} />
          </div>
        </div>
      )}

      <ResumeRedesignDialog
        open={resumeDialogOpen}
        onOpenChange={setResumeDialogOpen}
      />

      <DashboardOnboarding
        open={walkthroughOpen}
        onOpenChange={handleWalkthroughClose}
        onComplete={handleWalkthroughComplete}
        variant={isEmpty ? 'empty' : 'projects'}
        skipGenerate={generateWalkthroughCompleted}
      />
    </>
  );
}
