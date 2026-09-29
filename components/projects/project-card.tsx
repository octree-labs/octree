'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import { Copy, FileText, MoreVertical, Pencil, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Project } from '@/types/project';
import { cn } from '@/lib/utils';
import { previewUrl } from '@/lib/utils/project-preview-path';

dayjs.extend(relativeTime);

function ProjectThumbnail({ projectId }: { projectId: string }) {
  const [status, setStatus] = useState<'loading' | 'loaded' | 'missing'>(
    'loading'
  );
  const imgRef = useRef<HTMLImageElement>(null);

  useEffect(() => {
    const img = imgRef.current;
    if (img?.complete) setStatus(img.naturalWidth ? 'loaded' : 'missing');
  }, []);

  return (
    <div className="relative aspect-video w-full bg-muted/40">
      {status === 'loading' && (
        <Skeleton className="absolute inset-0 rounded-none" />
      )}
      {status === 'missing' && (
        <FileText className="absolute inset-0 m-auto size-8 text-muted-foreground" />
      )}
      {status !== 'missing' && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          ref={imgRef}
          src={previewUrl(projectId)}
          alt=""
          loading="lazy"
          decoding="async"
          className={cn(
            'absolute inset-0 h-full w-full object-cover object-top transition-opacity duration-300',
            status === 'loaded' ? 'opacity-100' : 'opacity-0'
          )}
          onLoad={() => setStatus('loaded')}
          onError={() => setStatus('missing')}
        />
      )}
    </div>
  );
}

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
      <ProjectThumbnail projectId={project.id} />
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
