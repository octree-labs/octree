'use client';

import { createProject } from '../actions/create-project';
import { useProjectRefresh } from '@/app/context/project';
import { AnalyticsEvents } from '@/lib/analytics/events';
import { track } from '@/lib/analytics/track';

export function useCreateProject() {
  const { refreshProjects } = useProjectRefresh();

  const createProjectWithRefresh = async (title: string) => {
    const result = await createProject(title);

    if (result.success) {
      track(AnalyticsEvents.PROJECT_CREATED, { source: 'dashboard' });
      refreshProjects();
    }

    return result;
  };

  return { createProjectWithRefresh };
}
