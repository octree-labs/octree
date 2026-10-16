'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Loader2 } from 'lucide-react';
import { useRenameProject } from '@/hooks/rename-project-client';

interface RenameProjectDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  project: { id: string; title: string } | null;
  onSuccess: (id: string, newTitle: string) => void;
  onError: (id: string, originalTitle: string) => void;
}

export function RenameProjectDialog({
  open,
  onOpenChange,
  project,
  onSuccess,
  onError,
}: RenameProjectDialogProps) {
  const [renameValue, setRenameValue] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { renameProjectWithRefresh } = useRenameProject();

  useEffect(() => {
    if (open && project) {
      setRenameValue(project.title);
      setError(null);
    }
  }, [open, project]);

  const handleRename = async () => {
    if (!project) return;

    const nextTitle = renameValue.trim();
    if (!nextTitle) {
      setError('Title is required');
      return;
    }

    setIsLoading(true);
    setError(null);

    const res = await renameProjectWithRefresh(project.id, nextTitle);

    if (!res.success) {
      setError(res.message || 'Failed to rename project');
      onError(project.id, project.title);
    } else {
      onSuccess(project.id, nextTitle);
      onOpenChange(false);
    }

    setIsLoading(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !isLoading) {
      handleRename();
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(isOpen) => {
        onOpenChange(isOpen);
        if (!isOpen) setError(null);
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="pr-6">Rename Project</DialogTitle>
          <DialogDescription>
            Update the title for{' '}
            <span className="break-all font-semibold">
              &quot;{project?.title}&quot;
            </span>
            .
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Input
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Project title"
            autoFocus
          />
          {error && (
            <div className="rounded-md bg-red-50 p-3 text-sm text-red-600">
              {error}
            </div>
          )}
        </div>
        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={isLoading}
          >
            Cancel
          </Button>
          <Button onClick={handleRename} variant="gradient" disabled={isLoading}>
            {isLoading ? (
              <>
                <Loader2 className="animate-spin" />
                Saving...
              </>
            ) : (
              'Save'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
