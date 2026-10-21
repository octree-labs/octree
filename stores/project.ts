import { create } from 'zustand';
import type { Project } from '@/types/project';

type ProjectStoreState = {
  project: Project | null;
  /**
   * The one-off export unlock (project_export_unlocks) for
   * `exportUnlockProjectId`, loaded server-side by the project layout. Kept
   * with its project id so a value from the previous project never applies
   * to the next one; read it through `useExportUnlocked(projectId)`.
   */
  exportUnlocked: boolean;
  exportUnlockProjectId: string | null;
};

const DEFAULT_STATE: ProjectStoreState = {
  project: null,
  exportUnlocked: false,
  exportUnlockProjectId: null,
};

export const useProjectStore = create<ProjectStoreState>(() => DEFAULT_STATE);

export const useProject = () => {
  return useProjectStore((state) => state.project);
};

/** True only when the unlock loaded for exactly this project says so. */
export function isExportUnlocked(state: ProjectStoreState, projectId: string | null | undefined): boolean {
  return !!projectId && state.exportUnlockProjectId === projectId && state.exportUnlocked;
}

export const useExportUnlocked = (projectId: string | null | undefined) => {
  return useProjectStore((state) => isExportUnlocked(state, projectId));
};

const setState = useProjectStore.setState;

export const ProjectActions = {
  setProject: (project: Project | null) => {
    setState({ project });
  },

  init: (project: Project) => {
    setState({ project });
  },

  setExportUnlocked: (projectId: string, exportUnlocked: boolean) => {
    setState({ exportUnlockProjectId: projectId, exportUnlocked });
  },
};
