'use client';

import { useEffect, useState } from 'react';
import { columns } from './columns';
import { DataTable } from './data-table';
import { Search } from 'lucide-react';
import { Project, SelectedProject } from '@/types/project';
import { useProjectRefresh } from '@/app/context/project';
import { Input } from '@/components/ui/input';
import { RenameProjectDialog } from './rename-project-dialog';
import { DeleteProjectDialog } from './delete-project-dialog';

export function ProjectsTable({ data }: { data: Project[] }) {
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [selectedProject, setSelectedProject] =
    useState<SelectedProject | null>(null);
  const [rows, setRows] = useState<Project[]>(data);
  const [isRenameDialogOpen, setIsRenameDialogOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [filteredRows, setFilteredRows] = useState<Project[]>(data);
  const { refreshProjects } = useProjectRefresh();

  useEffect(() => {
    setRows(data);
    setFilteredRows(data);
  }, [data]);

  useEffect(() => {
    if (!searchQuery.trim()) {
      setFilteredRows(rows);
    } else {
      const filtered = rows.filter((project) =>
        project.title.toLowerCase().includes(searchQuery.toLowerCase())
      );
      setFilteredRows(filtered);
    }
  }, [searchQuery, rows]);

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
    setFilteredRows((prev) => {
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
    setFilteredRows((prev) =>
      prev.map((p) => (p.id === id ? { ...p, title: originalTitle } : p))
    );
  };

  const handleDeleteSuccess = (id: string) => {
    setRows((prev) => prev.filter((p) => p.id !== id));
    setFilteredRows((prev) => prev.filter((p) => p.id !== id));
    refreshProjects();
  };

  return (
    <>
      <div className="mb-6">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" />
          <Input
            type="text"
            placeholder="Search projects..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10"
          />
        </div>
        {searchQuery && (
          <p className="mt-2 text-sm text-neutral-500">
            {filteredRows.length} project{filteredRows.length !== 1 ? 's' : ''}{' '}
            found
          </p>
        )}
      </div>

      <DataTable
        columns={columns({
          onDelete: handleDeleteClick,
          onRename: handleRenameClick,
        })}
        data={filteredRows}
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
