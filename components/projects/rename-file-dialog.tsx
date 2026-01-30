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
import { renameFile } from '@/lib/requests/project';

interface RenameFileDialogProps {
  projectId: string;
  fileId: string;
  currentName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRenamed?: (newName: string) => void;
}

export function RenameFileDialog({
  projectId,
  fileId,
  currentName,
  open,
  onOpenChange,
  onRenamed,
}: RenameFileDialogProps) {
  const [fileName, setFileName] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { revalidate } = useProjectFilesRevalidation(projectId);

  const folderPath = currentName.includes('/')
    ? currentName.substring(0, currentName.lastIndexOf('/'))
    : '';
  const currentFileName = currentName.includes('/')
    ? currentName.substring(currentName.lastIndexOf('/') + 1)
    : currentName;

  useEffect(() => {
    if (open) {
      setFileName(currentFileName);
      setError(null);
    }
  }, [open, currentFileName]);

  const handleRename = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmedName = fileName.trim();

    if (!trimmedName) {
      setError('File name is required');
      return;
    }

    if (trimmedName === currentFileName) {
      onOpenChange(false);
      return;
    }

    const newFullPath = folderPath
      ? `${folderPath}/${trimmedName}`
      : trimmedName;

    setIsLoading(true);
    setError(null);

    try {
      await renameFile(projectId, currentName, newFullPath);
      onRenamed?.(newFullPath);
      onOpenChange(false);
      
      revalidate().then(() => {
        toast.success('File renamed successfully');
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Failed to rename file';
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
          <DialogTitle>Rename File</DialogTitle>
          <DialogDescription>
            Update the file name. This will also update the associated document
            name.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleRename} className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="file-name">File name</Label>
            <Input
              id="file-name"
              value={fileName}
              onChange={(event) => setFileName(event.target.value)}
              placeholder="Enter a new file name"
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
