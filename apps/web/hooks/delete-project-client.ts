'use client';

import { deleteProject } from '@/actions/delete-project';
import { useProjectRefresh } from '@/app/context/project';

export function useDeleteProject() {
  const { refreshProjects } = useProjectRefresh();

  const deleteProjectWithRefresh = async (projectId: string) => {
    const result = await deleteProject(projectId);

    if (result.success) {
      refreshProjects();
    }

    return result;
  };

  return { deleteProjectWithRefresh };
}
