import type React from 'react';
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from '@/components/ui/sidebar';
import { AppSidebar } from '@/components/app-sidebar';
import { BackButton } from '@/components/projects/back-button';
import { ProjectBreadcrumbs } from '@/components/projects/project-breadcrumbs';
import { getProjectById } from '@/actions/get-projects';
import { getCurrentUser, getUserUsageStatus } from '@/actions/get-user';
import { getUserWalkthroughStatus } from '@/actions/get-walkthrough';
import { PaywallDialog } from '@/components/subscription/paywall-dialog';
import { EditorWalkthroughWrapper } from '@/components/editor/editor-walkthrough-wrapper';

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
  const project = await getProjectById(projectId);
  const walkthroughStatus = user ? await getUserWalkthroughStatus(user.id) : null;
  const shouldShowEditorWalkthrough = !walkthroughStatus?.editor_seen;

  // Check if user needs to see paywall
  // TEMPORARILY DISABLED - allowing users to enter without paywall
  // const usage = user ? await getUserUsageStatus(user.id) : null;
  // const showPaywall = usage?.onboarding_completed && !usage?.is_pro;

  return (
    <DragDropProvider>
      <SidebarProvider defaultOpen={true}>
        {/* {showPaywall && user?.email && <PaywallDialog userEmail={user.email} />} */}

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
          </header>

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
