'use client';

import { duplicateProject } from '@/actions/duplicate-project';
import { useProjectRefresh } from '@/app/context/project';

export function useDuplicateProject() {
  const { refreshProjects } = useProjectRefresh();

  const duplicateProjectWithRefresh = async (projectId: string) => {
    const result = await duplicateProject(projectId);

    if (result.success) {
      refreshProjects();
    }

    return result;
  };

  return { duplicateProjectWithRefresh };
}
