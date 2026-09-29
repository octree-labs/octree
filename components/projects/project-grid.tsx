'use client';

import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Project } from '@/types/project';
import { ProjectCard, ProjectCardActions } from './project-card';

const PAGE_SIZE = 12;

export function ProjectGrid({
  data,
  ...actions
}: { data: Project[] } & ProjectCardActions) {
  const [page, setPage] = useState(0);
  const pageCount = Math.max(1, Math.ceil(data.length / PAGE_SIZE));

  useEffect(() => {
    setPage(0);
  }, [data]);

  const visible = data.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  return (
    <div className="space-y-4">
      {visible.length ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {visible.map((project) => (
            <ProjectCard
              key={project.id}
              project={project}
              {...actions}
            />
          ))}
        </div>
      ) : (
        <p className="rounded-md border py-12 text-center text-sm text-muted-foreground">
          No results.
        </p>
      )}

      <div className="flex flex-col gap-4 px-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="text-sm text-neutral-500">
          Page {page + 1} of {pageCount} ({data.length} total projects)
        </div>
        <div className="flex items-center space-x-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPage((p) => p - 1)}
            disabled={page === 0}
          >
            <ChevronLeft className="mr-1 h-4 w-4" />
            Previous
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPage((p) => p + 1)}
            disabled={page >= pageCount - 1}
          >
            Next
            <ChevronRight className="ml-1 h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
