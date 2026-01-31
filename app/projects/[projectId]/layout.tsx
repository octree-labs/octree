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
import { PaywallDialog } from '@/components/subscription/paywall-dialog';

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
              <SidebarTrigger />
              <span className="text-neutral-300">|</span>
              <BackButton />
            </div>

            <div className="flex w-full min-w-0 items-center justify-center px-[135px]">
              <ProjectBreadcrumbs projectTitle={project?.title || 'Project'} />
            </div>
          </header>

          <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
        </SidebarInset>
      </SidebarProvider>
    </DragDropProvider>
  );
}
