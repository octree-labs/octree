import { create } from 'zustand';
import type { Project } from '@/types/project';

type ProjectStoreState = {
  project: Project | null;
};

const DEFAULT_STATE: ProjectStoreState = {
  project: null,
};

export const useProjectStore = create<ProjectStoreState>(() => DEFAULT_STATE);

export const useProject = () => {
  return useProjectStore((state) => state.project);
};

const setState = useProjectStore.setState;

export const ProjectActions = {
  setProject: (project: Project | null) => {
    setState({ project });
  },

  init: (project: Project) => {
    setState({ project });
  },
};
