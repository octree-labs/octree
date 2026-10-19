'use client';

import { createProject } from '../actions/create-project';
import { useProjectRefresh } from '@/app/context/project';
import { AnalyticsEvents, type ProjectSource } from '@/lib/analytics/events';
import { track } from '@/lib/analytics/track';

export function useCreateProject() {
  const { refreshProjects } = useProjectRefresh();

  /** Creates an empty project (main.tex from the default template). */
  const createProjectWithRefresh = async (title: string, source: ProjectSource = 'blank') => {
    const result = await createProject(title);

    if (result.success) {
      track(AnalyticsEvents.PROJECT_CREATED, { source });
      refreshProjects();
    }

    return result;
  };

  return { createProjectWithRefresh, refreshProjects };
}
