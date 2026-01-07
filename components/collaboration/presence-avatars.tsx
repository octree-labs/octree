'use client';

import { useCollaborators, useIsCollaborating } from '@/stores/collaboration';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { Users } from 'lucide-react';

export function PresenceAvatars() {
  const collaborators = useCollaborators();
  const isConnected = useIsCollaborating();

  if (!isConnected || collaborators.length === 0) {
    return null;
  }

  const displayedCollaborators = collaborators.slice(0, 3);
  const remainingCount = collaborators.length - 3;

  return (
    <TooltipProvider>
      <div className="flex items-center gap-1">
        <Users className="h-4 w-4 text-muted-foreground" />
        <div className="flex -space-x-2">
          {displayedCollaborators.map((collaborator) => (
            <Tooltip key={collaborator.user_id}>
              <TooltipTrigger asChild>
                <div
                  className="flex h-7 w-7 items-center justify-center rounded-full border-2 border-white text-xs font-medium text-white shadow-sm transition-transform hover:scale-110 hover:z-10"
                  style={{ backgroundColor: collaborator.color }}
                >
                  {(collaborator.name || 'U')[0].toUpperCase()}
                </div>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                <p>{collaborator.name || 'Unknown user'}</p>
                <p className="text-xs text-muted-foreground">Editing</p>
              </TooltipContent>
            </Tooltip>
          ))}
          {remainingCount > 0 && (
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="flex h-7 w-7 items-center justify-center rounded-full border-2 border-white bg-slate-500 text-xs font-medium text-white shadow-sm">
                  +{remainingCount}
                </div>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                <p>{remainingCount} more collaborator{remainingCount > 1 ? 's' : ''}</p>
              </TooltipContent>
            </Tooltip>
          )}
        </div>
      </div>
    </TooltipProvider>
  );
}

