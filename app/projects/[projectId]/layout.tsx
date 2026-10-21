import type React from 'react';
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from '@/components/ui/sidebar';
import { AppSidebar } from '@/components/app-sidebar';
import { BackButton } from '@/components/projects/back-button';
import { ProjectBreadcrumbs } from '@/components/projects/project-breadcrumbs';
import { SaveStatus } from '@/components/projects/save-status';
import { getProjectById } from '@/actions/get-projects';
import { getProjectExportUnlocked } from '@/actions/get-export-unlock';
import { getCurrentUser } from '@/actions/get-user';
import { getUserWalkthroughStatus } from '@/actions/get-walkthrough';
import { PaywallDialog } from '@/components/subscription/paywall-dialog';
import { DunningBanner } from '@/components/subscription/dunning-banner';
import { EditorWalkthroughWrapper } from '@/components/editor/editor-walkthrough-wrapper';
import { ExportUnlockSync } from '@/components/projects/export-unlock-sync';

import { DragDropProvider } from '@/components/providers/dnd-provider';

export default async function ProjectLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const user = await getCurrentUser();
  const userName = user?.user_metadata?.name ?? user?.email ?? null;
  const [project, exportUnlocked, walkthroughStatus] = await Promise.all([
    getProjectById(projectId),
    // The one-off export unlock for this project (owner-only by RLS).
    user ? getProjectExportUnlocked(projectId) : Promise.resolve(false),
    user ? getUserWalkthroughStatus(user.id) : Promise.resolve(null),
  ]);
  const shouldShowEditorWalkthrough = !walkthroughStatus?.editor_seen;

  return (
    <DragDropProvider>
      <SidebarProvider defaultOpen={true}>
        {/* Opened by the AI-edit limit and the export menu (stores/paywall.ts) */}
        <PaywallDialog />
        <ExportUnlockSync projectId={projectId} exportUnlocked={exportUnlocked} />

        <AppSidebar userName={userName} />
        <SidebarInset className="flex h-screen flex-col overflow-hidden">
          <header className="relative flex flex-shrink-0 items-center justify-between border-b px-4 py-3">
            <div className="absolute left-2 flex items-center gap-2">
              <SidebarTrigger className="hidden md:flex" />
              <span className="hidden text-neutral-300 md:inline">|</span>
              <span data-onboarding-target="editor-back">
                <BackButton />
              </span>
            </div>

            <div className="flex w-full min-w-0 items-center justify-center px-[135px]">
              <ProjectBreadcrumbs projectTitle={project?.title || 'Project'} />
            </div>

            <div className="absolute right-4 flex items-center">
              <SaveStatus />
            </div>
          </header>

          {/* "Your last payment failed" while the subscription is past_due. */}
          <DunningBanner location="editor" />

          <div className="min-h-0 flex-1 overflow-hidden">
            <EditorWalkthroughWrapper
              userId={user?.id}
              shouldShowEditorWalkthrough={shouldShowEditorWalkthrough}
            >
              {children}
            </EditorWalkthroughWrapper>
          </div>
        </SidebarInset>
      </SidebarProvider>
    </DragDropProvider>
  );
}
