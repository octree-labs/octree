'use client';

import { useState } from 'react';
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
import { Loader2 } from 'lucide-react';
import { useProjectFilesRevalidation } from '@/hooks/use-file-editor';
import { deleteFolder } from '@/lib/requests/project';

interface DeleteFolderDialogProps {
  projectId: string;
  folderPath: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDeleted?: () => void;
}

export function DeleteFolderDialog({
  projectId,
  folderPath,
  open,
  onOpenChange,
  onDeleted,
}: DeleteFolderDialogProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { revalidate } = useProjectFilesRevalidation(projectId);

  const folderName = folderPath.split('/').pop() || folderPath;

  const handleDelete = async () => {
    setIsLoading(true);
    setError(null);

    try {
      await deleteFolder(projectId, folderPath);
      onDeleted?.();
      onOpenChange(false);

      revalidate().then(() => {
        toast.success('Folder deleted successfully');
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Failed to delete folder';
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
          <DialogTitle>Delete Folder</DialogTitle>
          <DialogDescription>
            Are you sure you want to delete &quot;{folderName}&quot; and all its
            contents? This action cannot be undone.
          </DialogDescription>
        </DialogHeader>
        {error && (
          <div className="rounded-md bg-red-50 p-3 text-sm text-red-600">
            {error}
          </div>
        )}
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isLoading}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={handleDelete}
            disabled={isLoading}
          >
            {isLoading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Deleting...
              </>
            ) : (
              'Delete'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

