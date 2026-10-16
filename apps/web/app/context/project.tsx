'use client';

import { createContext, useContext, useState, useCallback } from 'react';

interface ProjectContextType {
  refreshProjects: () => void;
  refreshTrigger: number;
}

const ProjectContext = createContext<ProjectContextType | undefined>(undefined);

export function ProjectProvider({ children }: { children: React.ReactNode }) {
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  const refreshProjects = useCallback(() => {
    setRefreshTrigger((prev) => prev + 1);
  }, []);

  return (
    <ProjectContext.Provider value={{ refreshProjects, refreshTrigger }}>
      {children}
    </ProjectContext.Provider>
  );
}

export function useProjectRefresh() {
  const context = useContext(ProjectContext);
  if (context === undefined) {
    throw new Error('useProjectRefresh must be used within a ProjectProvider');
  }
  return context;
}
