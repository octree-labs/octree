'use client';

import { useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Project } from '@/types/project';
import { ProjectCard, ProjectCardActions } from './project-card';

const PAGE_SIZE = 12;

export function ProjectGrid({
  data,
  ...actions
}: { data: Project[] } & ProjectCardActions) {
  const [selectedPage, setSelectedPage] = useState(0);
  const pageCount = Math.max(1, Math.ceil(data.length / PAGE_SIZE));
  const page = Math.min(selectedPage, pageCount - 1);

  const visible = data.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Only the cards scroll; the pagination row below stays at the bottom.
          The -m-1/p-1 pair keeps card shadows from being clipped. */}
      <div className="-m-1 min-h-0 flex-1 overflow-y-auto p-1 pb-4">
        {visible.length ? (
          // As many columns as fit the space left by the sidebar.
          <div className="grid grid-cols-[repeat(auto-fill,minmax(15rem,1fr))] gap-4">
            {visible.map((project) => (
              <ProjectCard key={project.id} project={project} {...actions} />
            ))}
          </div>
        ) : (
          <p className="rounded-md border py-12 text-center text-sm text-muted-foreground">
            No results.
          </p>
        )}
      </div>

      <div className="flex shrink-0 flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-gray-200 px-2 py-3">
        <div className="text-sm text-neutral-500">
          Page {page + 1} of {pageCount} ({data.length} total projects)
        </div>
        <div className="flex items-center space-x-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setSelectedPage(page - 1)}
            disabled={page === 0}
          >
            <ChevronLeft className="mr-1 h-4 w-4" />
            Previous
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setSelectedPage(page + 1)}
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
