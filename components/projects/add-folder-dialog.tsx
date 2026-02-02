'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useProjectFilesRevalidation } from '@/hooks/use-file-editor';
import { createFolder } from '@/lib/requests/project';
import { toast } from 'sonner';

interface AddFolderDialogProps {
  projectId: string;
  projectTitle: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  targetFolder?: string | null;
}

export function AddFolderDialog({
  projectId,
  projectTitle,
  open,
  onOpenChange,
  targetFolder = null,
}: AddFolderDialogProps) {
  const [folderName, setFolderName] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { revalidate } = useProjectFilesRevalidation(projectId);

  const handleCreateFolder = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!folderName.trim()) {
      setError('Folder name is required');
      return;
    }

    const sanitizedName = folderName.trim().replace(/^\/+|\/+$/g, '');
    if (!sanitizedName) {
      setError('Invalid folder name');
      return;
    }

    if (sanitizedName.includes('..')) {
      setError('Folder name cannot contain ".."');
      return;
    }

    setIsLoading(true);

    try {
      const folderPath = targetFolder
        ? `${targetFolder}/${sanitizedName}`
        : sanitizedName;

      await createFolder(projectId, folderPath);

      handleOpenChange(false);
      
      revalidate().then(() => {
        toast.success('Folder created successfully');
      });
    } catch (err) {
      console.error('Error creating folder:', err);
      setError(err instanceof Error ? err.message : 'Failed to create folder');
    } finally {
      setIsLoading(false);
    }
  };

  const handleOpenChange = (newOpen: boolean) => {
    onOpenChange(newOpen);
    if (!newOpen) {
      setFolderName('');
      setError(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle className="break-all pr-8 leading-normal">Add Folder to {projectTitle}</DialogTitle>
          <DialogDescription>
            Create a new folder in this project.
            {targetFolder && (
              <span className="mt-1 block text-xs break-all">
                Location: {targetFolder}
              </span>
            )}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleCreateFolder} className="grid gap-4">
          <div className="grid gap-3">
            <Label htmlFor="folderName">Folder Name</Label>
            <Input
              id="folderName"
              value={folderName}
              onChange={(e) => setFolderName(e.target.value)}
              placeholder="Enter folder name (e.g., images)"
              disabled={isLoading}
            />
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => handleOpenChange(false)}
              disabled={isLoading}
            >
              Cancel
            </Button>
            <Button type="submit" variant="gradient" disabled={isLoading}>
              {isLoading ? 'Creating...' : 'Create Folder'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
