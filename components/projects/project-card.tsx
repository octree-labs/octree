'use client';

import { useRouter } from 'next/navigation';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import { Copy, FileText, MoreVertical, Pencil, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Project } from '@/types/project';
import { previewUrl } from '@/lib/utils/project-preview-path';

dayjs.extend(relativeTime);

export interface ProjectCardActions {
  onDelete: (projectId: string, projectTitle: string) => void;
  onRename: (projectId: string, projectTitle: string) => void;
  onDuplicate: (projectId: string) => void;
}

export function ProjectCard({
  project,
  onDelete,
  onRename,
  onDuplicate,
}: { project: Project } & ProjectCardActions) {
  const router = useRouter();

  return (
    <div
      className="cursor-pointer overflow-hidden rounded-xl border bg-card transition-shadow hover:shadow-md"
      onClick={() => router.push(`/projects/${project.id}`)}
    >
      {/* Placeholder sits underneath; a loaded preview covers it, a missing one shows through. */}
      <div className="relative aspect-video w-full bg-muted/40">
        <FileText className="absolute inset-0 m-auto size-8 text-muted-foreground" />
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={previewUrl(project.id)}
          alt=""
          loading="lazy"
          decoding="async"
          className="absolute inset-0 h-full w-full object-cover object-top"
          onError={(e) => (e.currentTarget.style.visibility = 'hidden')}
        />
      </div>
      <div className="flex items-center justify-between gap-2 border-t p-4">
        <div className="min-w-0">
          <p className="truncate font-medium" title={project.title}>
            {project.title}
          </p>
          <p className="text-sm text-muted-foreground">
            Edited {dayjs(project.updated_at).fromNow()}
          </p>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              className="h-8 w-8 shrink-0 p-0"
              onClick={(e) => e.stopPropagation()}
            >
              <span className="sr-only">Open menu</span>
              <MoreVertical className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
            <DropdownMenuLabel>Actions</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="cursor-pointer"
              onClick={() => onRename(project.id, project.title)}
            >
              <Pencil className="size-4" />
              Rename
            </DropdownMenuItem>
            <DropdownMenuItem
              className="cursor-pointer"
              onClick={() => onDuplicate(project.id)}
            >
              <Copy className="size-4" />
              Duplicate
            </DropdownMenuItem>
            <DropdownMenuItem
              className="cursor-pointer"
              variant="destructive"
              onClick={() => onDelete(project.id, project.title)}
            >
              <Trash2 className="size-4 text-destructive" />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}
