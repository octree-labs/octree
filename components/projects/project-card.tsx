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
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { DashboardProject } from '@/types/project';
import { cn } from '@/lib/utils';
import { getProjectPreviewUrl } from '@/lib/requests/project';

dayjs.extend(relativeTime);

// `src` is a signed URL made when the dashboard was rendered (the bucket is
// private), or null when the project has no thumbnail yet.
function ProjectThumbnail({
  projectId,
  src,
}: {
  projectId: string;
  src: string | null;
}) {
  // The URL the <img> uses. A refresh (revalidatePath after rename, delete,
  // duplicate) hands in a new signed URL for the same image; the one already
  // shown is kept so the browser does not download it again, unless it failed.
  const [shownSrc, setShownSrc] = useState(src);
  const [loadedSrc, setLoadedSrc] = useState<string | null>(null);
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const resignedRef = useRef(false);
  const imgRef = useRef<HTMLImageElement>(null);

  // A newer URL from a refresh replaces one that failed (e.g. expired).
  if (src && shownSrc === failedSrc && src !== shownSrc) {
    setShownSrc(src);
  }

  const status: 'loading' | 'loaded' | 'missing' =
    !shownSrc || shownSrc === failedSrc
      ? 'missing'
      : shownSrc === loadedSrc
        ? 'loaded'
        : 'loading';

  const handleError = () => {
    const failed = shownSrc;
    setFailedSrc(failed);
    // Signed URLs expire (SIGNED_URL_TTL_SECONDS): an image first requested
    // late (another page of the grid, a search, a lazy card scrolled into
    // view) gets one fresh URL before falling back to the placeholder.
    if (resignedRef.current) return;
    resignedRef.current = true;
    getProjectPreviewUrl(projectId)
      .then((url) => {
        if (url) setShownSrc((cur) => (cur === failed ? url : cur));
      })
      .catch(() => {});
  };

  useEffect(() => {
    const img = imgRef.current;
    if (!img?.complete || !shownSrc) return;
    if (img.naturalWidth) setLoadedSrc(shownSrc);
    else handleError();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shownSrc]);

  return (
    <div className="relative aspect-video w-full bg-muted/40">
      {status === 'loading' && (
        <Skeleton className="absolute inset-0 rounded-none" />
      )}
      {status === 'missing' && (
        <FileText className="absolute inset-0 m-auto size-8 text-muted-foreground" />
      )}
      {shownSrc && status !== 'missing' && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          ref={imgRef}
          src={shownSrc}
          alt=""
          loading="lazy"
          decoding="async"
          className={cn(
            'absolute inset-0 h-full w-full object-cover object-top transition-opacity duration-300',
            status === 'loaded' ? 'opacity-100' : 'opacity-0'
          )}
          onLoad={() => setLoadedSrc(shownSrc)}
          onError={handleError}
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
}: { project: DashboardProject } & ProjectCardActions) {
  const router = useRouter();

  return (
    <div
      className="cursor-pointer overflow-hidden rounded-xl border bg-card transition-shadow hover:shadow-md"
      onClick={() => router.push(`/projects/${project.id}`)}
    >
      {/* Remount only when a thumbnail appears or disappears; a refreshed
          URL for the same image keeps the current one on screen. */}
      <ProjectThumbnail
        key={project.preview_url ? 'preview' : 'none'}
        projectId={project.id}
        src={project.preview_url}
      />
      <div className="flex items-center justify-between gap-1 border-t py-4 pl-4 pr-2">
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
              className="h-8 w-6 shrink-0 p-0"
              onClick={(e) => e.stopPropagation()}
            >
              <span className="sr-only">Open menu</span>
              <MoreVertical className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
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
