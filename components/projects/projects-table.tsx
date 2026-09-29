'use client';

import { useEffect, useMemo, useState } from 'react';
import { ProjectGrid } from './project-grid';
import { Project, SelectedProject } from '@/types/project';
import { useProjectRefresh } from '@/app/context/project';
import { RenameProjectDialog } from './rename-project-dialog';
import { DeleteProjectDialog } from './delete-project-dialog';
import { useDuplicateProject } from '@/hooks/duplicate-project-client';
import { toast } from 'sonner';

export function ProjectsTable({
  data,
  searchQuery,
}: {
  data: Project[];
  searchQuery: string;
}) {
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [selectedProject, setSelectedProject] =
    useState<SelectedProject | null>(null);
  const [rows, setRows] = useState<Project[]>(data);
  const [isRenameDialogOpen, setIsRenameDialogOpen] = useState(false);
  const { refreshProjects } = useProjectRefresh();
  const { duplicateProjectWithRefresh } = useDuplicateProject();

  useEffect(() => {
    setRows(data);
  }, [data]);

  const filteredRows = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return query
      ? rows.filter((p) => p.title.toLowerCase().includes(query))
      : rows;
  }, [rows, searchQuery]);

  const handleDeleteClick = (projectId: string, projectTitle: string) => {
    setSelectedProject({
      id: projectId,
      title: projectTitle,
    });
    setIsDeleteDialogOpen(true);
  };

  const handleRenameClick = (projectId: string, projectTitle: string) => {
    setSelectedProject({ id: projectId, title: projectTitle });
    setIsRenameDialogOpen(true);
  };

  const handleRenameSuccess = (id: string, newTitle: string) => {
    const now = new Date().toISOString();
    setRows((prev) => {
      const updated = prev.map((p) =>
        p.id === id ? { ...p, title: newTitle, updated_at: now } : p
      );
      return updated.sort(
        (a, b) =>
          new Date(b.updated_at ?? 0).getTime() -
          new Date(a.updated_at ?? 0).getTime()
      );
    });
    refreshProjects();
  };

  const handleRenameError = (id: string, originalTitle: string) => {
    setRows((prev) =>
      prev.map((p) => (p.id === id ? { ...p, title: originalTitle } : p))
    );
  };

  const handleDuplicateClick = async (projectId: string) => {
    const result = await duplicateProjectWithRefresh(projectId);
    if (result.success) {
      toast.success('Project duplicated');
    } else {
      toast.error(result.message || 'Failed to duplicate project');
    }
  };

  const handleDeleteSuccess = (id: string) => {
    setRows((prev) => prev.filter((p) => p.id !== id));
    refreshProjects();
  };

  return (
    <>
      {searchQuery && (
        <p className="mb-4 text-sm text-neutral-500">
          {filteredRows.length} project{filteredRows.length !== 1 ? 's' : ''}{' '}
          found
        </p>
      )}

      <ProjectGrid
        key={searchQuery}
        data={filteredRows}
        onDelete={handleDeleteClick}
        onRename={handleRenameClick}
        onDuplicate={handleDuplicateClick}
      />

      <DeleteProjectDialog
        open={isDeleteDialogOpen}
        onOpenChange={setIsDeleteDialogOpen}
        project={selectedProject}
        onSuccess={handleDeleteSuccess}
      />

      <RenameProjectDialog
        open={isRenameDialogOpen}
        onOpenChange={setIsRenameDialogOpen}
        project={selectedProject}
        onSuccess={handleRenameSuccess}
        onError={handleRenameError}
      />
    </>
  );
}
