'use client';

import { renameProject } from '@/actions/rename-project';
import { useProjectRefresh } from '@/app/context/project';

export function useRenameProject() {
  const { refreshProjects } = useProjectRefresh();

  const renameProjectWithRefresh = async (
    projectId: string,
    title: string
  ) => {
    const formData = new FormData();
    formData.append('projectId', projectId);
    formData.append('title', title);

    const result = await renameProject({ projectId: null }, formData);

    if (result.success) {
      refreshProjects();
    }

    return result;
  };

  return { renameProjectWithRefresh };
}


