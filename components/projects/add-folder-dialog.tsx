'use client';

import { useState, useRef } from 'react';
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { FolderPlus, FolderUp, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { createClient } from '@/lib/supabase/client';
import { useProjectFilesRevalidation } from '@/hooks/use-file-editor';
import { FileTreeActions } from '@/stores/file-tree';
import { createFolder } from '@/lib/requests/project';
import { getContentTypeByFilename } from '@/lib/constants/file-types';
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
  const [folderFiles, setFolderFiles] = useState<File[]>([]);
  const [mode, setMode] = useState<'create' | 'upload'>('create');
  const [uploadProgress, setUploadProgress] = useState<string | null>(null);
  const { revalidate } = useProjectFilesRevalidation(projectId);
  const folderInputRef = useRef<HTMLInputElement>(null);

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
    FileTreeActions.setLoading(true);

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
      FileTreeActions.setLoading(false);
      console.error('Error creating folder:', err);
      setError(err instanceof Error ? err.message : 'Failed to create folder');
    } finally {
      setIsLoading(false);
    }
  };

  const handleFolderSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    // Filter out hidden files and system files
    const validFiles = Array.from(files).filter((file) => {
      const path = file.webkitRelativePath || file.name;
      const parts = path.split('/');
      return !parts.some((part) => part.startsWith('.'));
    });

    setFolderFiles(validFiles);
    setError(null);

    // Reset input so the same folder can be re-selected
    if (folderInputRef.current) {
      folderInputRef.current.value = '';
    }
  };

  const removeFolderFile = (index: number) => {
    setFolderFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const handleFolderUpload = async () => {
    if (folderFiles.length === 0) return;

    setIsLoading(true);
    FileTreeActions.setLoading(true);
    setError(null);

    try {
      const supabase = createClient();

      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session?.user) {
        throw new Error('User not authenticated');
      }

      let uploadedCount = 0;
      const totalFiles = folderFiles.length;
      const errors: string[] = [];
      const CONCURRENCY = 5;

      const uploadOne = async (file: File) => {
        const relativePath = file.webkitRelativePath || file.name;
        const fullPath = targetFolder
          ? `${targetFolder}/${relativePath}`
          : relativePath;

        try {
          const mimeType = getContentTypeByFilename(file.name);
          const { error: uploadError } = await supabase.storage
            .from('octree')
            .upload(`projects/${projectId}/${fullPath}`, file, {
              cacheControl: '3600',
              upsert: false,
              contentType: mimeType,
            });

          if (uploadError) {
            errors.push(`${relativePath}: upload failed`);
            return;
          }

          uploadedCount++;
        } catch {
          errors.push(`${relativePath}: unexpected error`);
        }

        setUploadProgress(
          `Uploaded ${uploadedCount} of ${totalFiles}`
        );
      };

      // Upload in parallel batches
      for (let i = 0; i < folderFiles.length; i += CONCURRENCY) {
        const batch = folderFiles.slice(i, i + CONCURRENCY);
        setUploadProgress(
          `Uploading ${Math.min(i + CONCURRENCY, totalFiles)} of ${totalFiles}...`
        );
        await Promise.all(batch.map(uploadOne));
      }

      handleOpenChange(false);

      revalidate().then(() => {
        if (errors.length > 0 && uploadedCount > 0) {
          toast.success(
            `Uploaded ${uploadedCount} file${uploadedCount !== 1 ? 's' : ''}. ${errors.length} skipped.`
          );
        } else if (errors.length > 0) {
          toast.error(`Upload failed: ${errors.join(', ')}`);
        } else {
          toast.success(
            `${uploadedCount} file${uploadedCount !== 1 ? 's' : ''} uploaded successfully`
          );
        }
      });
    } catch (error) {
      FileTreeActions.setLoading(false);
      setError(
        error instanceof Error ? error.message : 'Failed to upload folder'
      );
    } finally {
      setIsLoading(false);
      setUploadProgress(null);
    }
  };

  const handleOpenChange = (newOpen: boolean) => {
    onOpenChange(newOpen);
    if (!newOpen) {
      setFolderName('');
      setFolderFiles([]);
      setError(null);
      setMode('create');
      setUploadProgress(null);
    }
  };

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  // Get unique folder names from folder files
  const folderNames = folderFiles.length > 0
    ? [...new Set(folderFiles.map((f) => (f.webkitRelativePath || f.name).split('/')[0]))]
    : [];

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle className="break-all pr-8 leading-normal">Add Folder to {projectTitle}</DialogTitle>
          <DialogDescription>
            Create a new empty folder or upload existing folders to this project.
            {targetFolder && (
              <span className="mt-1 block text-xs break-all">
                Location: {targetFolder}
              </span>
            )}
          </DialogDescription>
        </DialogHeader>

        {/* Hidden folder input */}
        <input
          ref={folderInputRef}
          type="file"
          className="hidden"
          onChange={handleFolderSelect}
          {...({ webkitdirectory: '', mozdirectory: '', directory: '' } as React.InputHTMLAttributes<HTMLInputElement>)}
          multiple
        />

        <Tabs
          value={mode}
          onValueChange={(value) => setMode(value as 'create' | 'upload')}
        >
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="create" disabled={isLoading}>
              <FolderPlus className="h-4 w-4" />
              Create Folder
            </TabsTrigger>
            <TabsTrigger value="upload" disabled={isLoading}>
              <FolderUp className="h-4 w-4" />
              Upload Folder
            </TabsTrigger>
          </TabsList>

          <TabsContent value="create" className="mt-4">
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
          </TabsContent>

          <TabsContent value="upload" className="mt-4">
            <div className="grid gap-4">
              <div className="grid gap-3">
                <Label>Select Folder</Label>
                <div
                  className={cn(
                    'relative cursor-pointer rounded-lg border-2 border-dashed p-6 text-center transition-colors duration-200',
                    'border-neutral-300 hover:border-neutral-400 hover:bg-neutral-50',
                    isLoading && 'cursor-not-allowed opacity-50'
                  )}
                  onClick={() => {
                    if (!isLoading) folderInputRef.current?.click();
                  }}
                >
                  <div className="flex flex-col items-center gap-2">
                    <FolderUp className="h-8 w-8 text-neutral-400" />
                    <div className="text-sm">
                      <span className="font-medium text-primary hover:underline">
                        Click to select folder
                      </span>
                    </div>
                    <p className="text-xs text-neutral-500">
                      Upload an entire folder with its contents. Folder
                      structure will be preserved.
                    </p>
                  </div>
                </div>

                {folderFiles.length > 0 && (
                  <div className="max-h-40 space-y-1.5 overflow-y-auto rounded-md border border-green-200 bg-green-50 p-3">
                    <p className="text-xs font-medium text-green-700">
                      {folderNames.length} folder
                      {folderNames.length !== 1 ? 's' : ''} ({folderFiles.length}{' '}
                      file{folderFiles.length !== 1 ? 's' : ''})
                    </p>
                    {folderFiles.map((file, index) => (
                      <div
                        key={`${file.webkitRelativePath}-${index}`}
                        className="flex items-center justify-between gap-2 text-sm text-green-700"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-xs font-medium">
                            {file.webkitRelativePath || file.name}
                          </p>
                          <p className="text-xs text-green-600">
                            {formatFileSize(file.size)}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => removeFolderFile(index)}
                          className="shrink-0 rounded p-0.5 text-green-600 hover:bg-green-100 hover:text-green-800"
                          disabled={isLoading}
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {uploadProgress && (
                <p className="text-xs text-neutral-500">{uploadProgress}</p>
              )}

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
                <Button
                  type="button"
                  variant="gradient"
                  onClick={handleFolderUpload}
                  disabled={isLoading || folderFiles.length === 0}
                >
                  {isLoading
                    ? 'Uploading...'
                    : `Upload ${folderFiles.length > 0 ? `${folderFiles.length} Files` : 'Folder'}`}
                </Button>
              </DialogFooter>
            </div>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
