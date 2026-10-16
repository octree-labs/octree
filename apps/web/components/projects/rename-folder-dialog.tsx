'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useProjectFilesRevalidation } from '@/hooks/use-file-editor';
import { renameFolder } from '@/lib/requests/project';

interface RenameFolderDialogProps {
  projectId: string;
  currentPath: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRenamed?: (newPath: string) => void;
}

export function RenameFolderDialog({
  projectId,
  currentPath,
  open,
  onOpenChange,
  onRenamed,
}: RenameFolderDialogProps) {
  const [folderName, setFolderName] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { revalidate } = useProjectFilesRevalidation(projectId);

  const parentPath = currentPath.includes('/')
    ? currentPath.substring(0, currentPath.lastIndexOf('/'))
    : '';
  const currentFolderName = currentPath.includes('/')
    ? currentPath.substring(currentPath.lastIndexOf('/') + 1)
    : currentPath;

  useEffect(() => {
    if (open) {
      setFolderName(currentFolderName);
      setError(null);
    }
  }, [open, currentFolderName]);

  const handleRename = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmedName = folderName.trim();

    if (!trimmedName) {
      setError('Folder name is required');
      return;
    }

    if (trimmedName === currentFolderName) {
      onOpenChange(false);
      return;
    }

    if (trimmedName.includes('/')) {
      setError('Folder name cannot contain "/"');
      return;
    }

    if (trimmedName.includes('..')) {
      setError('Folder name cannot contain ".."');
      return;
    }

    const newFullPath = parentPath
      ? `${parentPath}/${trimmedName}`
      : trimmedName;

    setIsLoading(true);
    setError(null);

    try {
      await renameFolder(projectId, currentPath, newFullPath);
      onRenamed?.(newFullPath);
      onOpenChange(false);

      revalidate().then(() => {
        toast.success('Folder renamed successfully');
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Failed to rename folder';
      setError(message);
      toast.error(message);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Rename Folder</DialogTitle>
          <DialogDescription>
            Update the folder name. All files within will be moved.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleRename} className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="folder-name">Folder name</Label>
            <Input
              id="folder-name"
              value={folderName}
              onChange={(event) => setFolderName(event.target.value)}
              placeholder="Enter a new folder name"
              autoFocus
            />
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isLoading}
            >
              Cancel
            </Button>
            <Button type="submit" variant="gradient" disabled={isLoading}>
              {isLoading ? 'Saving...' : 'Save changes'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
