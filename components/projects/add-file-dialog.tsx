'use client';

import { useState } from 'react';
import { useDropzone } from 'react-dropzone';
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
  DialogTrigger,
} from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Plus, Upload, FileText } from 'lucide-react';
import { cn } from '@/lib/utils';
import { createClient } from '@/lib/supabase/client';
import { useProjectFilesRevalidation } from '@/hooks/use-file-editor';
import { FileActions } from '@/stores/file';
import {
  ALL_SUPPORTED_FILE_TYPES,
  MAX_BINARY_FILE_SIZE,
  getContentTypeByFilename,
} from '@/lib/constants/file-types';
import { toast } from 'sonner';

interface AddFileDialogProps {
  projectId: string;
  projectTitle: string;
  onFileAdded?: () => void;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  targetFolder?: string | null;
}

export function AddFileDialog({
  projectId,
  projectTitle,
  onFileAdded,
  open: controlledOpen,
  onOpenChange,
  targetFolder = null,
}: AddFileDialogProps) {
  const [internalOpen, setInternalOpen] = useState(false);
  const open = controlledOpen !== undefined ? controlledOpen : internalOpen;
  const setOpen = onOpenChange || setInternalOpen;
  const [fileName, setFileName] = useState('');
  const [fileContent, setFileContent] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploadMode, setUploadMode] = useState<'create' | 'upload'>('create');
  const { revalidate } = useProjectFilesRevalidation(projectId);

  const onDrop = (acceptedFiles: File[]) => {
    if (acceptedFiles.length > 0) {
      const file = acceptedFiles[0];
      setSelectedFile(file);
      setFileName(file.name);
      setUploadMode('upload');
      setError(null);
    }
  };

  const {
    getRootProps,
    getInputProps,
    isDragActive,
    open: openFileDialog,
  } = useDropzone({
    onDrop,
    accept: ALL_SUPPORTED_FILE_TYPES,
    maxSize: MAX_BINARY_FILE_SIZE,
    multiple: false,
    disabled: isLoading,
    noClick: true,
    noKeyboard: true,
  });

  const handleFileUpload = async () => {
    if (!selectedFile || !fileName.trim()) return;

    setIsLoading(true);
    setError(null);

    try {
      const supabase = createClient();

      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session?.user) {
        throw new Error('User not authenticated');
      }

      const fullPath = targetFolder ? `${targetFolder}/${fileName}` : fileName;
      const mimeType = getContentTypeByFilename(fileName);
      const { error: uploadError } = await supabase.storage
        .from('octree')
        .upload(`projects/${projectId}/${fullPath}`, selectedFile, {
          cacheControl: '3600',
          upsert: false,
          contentType: mimeType,
        });

      if (uploadError) {
        throw new Error('Failed to upload file');
      }

      const { data: storageFiles } = await supabase.storage
        .from('octree')
        .list(`projects/${projectId}`);

      const uploadedFile = storageFiles?.find((f) => f.name === fileName);

      if (uploadedFile) {
        FileActions.setSelectedFile({
          id: uploadedFile.id,
          name: uploadedFile.name,
          project_id: projectId,
          size: uploadedFile.metadata?.size || null,
          type: uploadedFile.metadata?.mimetype || null,
          uploaded_at: uploadedFile.created_at,
        });
      }

      handleOpenChange(false);
      onFileAdded?.();

      revalidate().then(() => {
        toast.success('File uploaded successfully');
      });
    } catch (error) {
      setError(
        error instanceof Error ? error.message : 'Failed to upload file'
      );
    } finally {
      setIsLoading(false);
    }
  };

  const handleCreateFile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!fileName.trim()) return;

    setIsLoading(true);
    setError(null);

    try {
      const supabase = createClient();

      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session?.user) {
        throw new Error('User not authenticated');
      }

      const fullPath = targetFolder ? `${targetFolder}/${fileName}` : fileName;
      const content = fileContent || '';
      const mimeType = getContentTypeByFilename(fileName);
      const blob = new Blob([content], { type: mimeType });

      const { error: uploadError } = await supabase.storage
        .from('octree')
        .upload(`projects/${projectId}/${fullPath}`, blob, {
          cacheControl: '3600',
          upsert: false,
          contentType: mimeType,
        });

      if (uploadError) {
        throw new Error('Failed to create file');
      }

      const { data: storageFiles } = await supabase.storage
        .from('octree')
        .list(`projects/${projectId}`);

      const createdFile = storageFiles?.find((f) => f.name === fileName);

      handleOpenChange(false);
      onFileAdded?.();
      await revalidate();

      if (createdFile) {
        FileActions.setSelectedFile({
          id: createdFile.id,
          name: createdFile.name,
          project_id: projectId,
          size: createdFile.metadata?.size || null,
          type: createdFile.metadata?.mimetype || null,
          uploaded_at: createdFile.created_at,
        });
      }
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Failed to add file');
    } finally {
      setIsLoading(false);
    }
  };

  const handleSubmit =
    uploadMode === 'upload' ? handleFileUpload : handleCreateFile;

  const handleOpenChange = (newOpen: boolean) => {
    setOpen(newOpen);
    if (!newOpen) {
      setFileName('');
      setFileContent('');
      setSelectedFile(null);
      setError(null);
      setUploadMode('create');
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      {controlledOpen === undefined && (
        <DialogTrigger asChild>
          <button
            type="button"
            className="inline-flex h-5 w-5 items-center justify-center rounded-sm text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-900"
          >
            <Plus className="h-4 w-4" />
          </button>
        </DialogTrigger>
      )}
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Add File to {projectTitle}</DialogTitle>
          <DialogDescription>
            Create a new LaTeX file or upload files (PDFs, images, etc.) to this
            project.
          </DialogDescription>
        </DialogHeader>

        <Tabs
          value={uploadMode}
          onValueChange={(value) => setUploadMode(value as 'create' | 'upload')}
        >
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="create" disabled={isLoading}>
              <FileText className="h-4 w-4" />
              Create File
            </TabsTrigger>
            <TabsTrigger value="upload" disabled={isLoading}>
              <Upload className="h-4 w-4" />
              Upload File
            </TabsTrigger>
          </TabsList>

          <TabsContent value="create" className="mt-4">
            <form onSubmit={handleSubmit} className="grid gap-4">
              <div className="grid gap-3">
                <Label htmlFor="fileName">Name</Label>
                <Input
                  id="fileName"
                  value={fileName}
                  onChange={(e) => setFileName(e.target.value)}
                  placeholder="Enter file name (e.g., document.tex)"
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
                <Button type="submit" disabled={isLoading}>
                  {isLoading ? 'Creating...' : 'Create File'}
                </Button>
              </DialogFooter>
            </form>
          </TabsContent>

          <TabsContent value="upload" className="mt-4">
            <div className="grid gap-4">
              <div className="grid gap-3">
                <Label htmlFor="fileUpload">Select File</Label>
                <div
                  {...getRootProps()}
                  className={cn(
                    'relative cursor-pointer rounded-lg border-2 border-dashed p-6 text-center transition-colors duration-200',
                    isDragActive
                      ? 'border-primary bg-primary/5'
                      : 'border-neutral-300 hover:border-neutral-400 hover:bg-neutral-50',
                    isLoading && 'cursor-not-allowed opacity-50'
                  )}
                >
                  <input {...getInputProps()} />

                  <div className="flex flex-col items-center gap-2">
                    <Upload
                      className={cn(
                        'h-8 w-8',
                        isDragActive ? 'text-primary' : 'text-neutral-400'
                      )}
                    />
                    <div className="text-sm">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          openFileDialog();
                        }}
                        className="font-medium text-primary hover:underline"
                        disabled={isLoading}
                      >
                        Click to upload
                      </button>
                      <span className="text-neutral-600">
                        {' '}
                        or drag and drop
                      </span>
                    </div>
                    <p className="text-xs text-neutral-500">
                      Supports LaTeX files, PDFs, and images (max{' '}
                      {MAX_BINARY_FILE_SIZE / 1024 / 1024}MB)
                    </p>
                  </div>
                </div>

                {selectedFile && (
                  <div className="rounded-md border border-green-200 bg-green-50 p-3 text-sm text-green-700">
                    <p className="font-medium">Selected: {selectedFile.name}</p>
                    <p className="text-xs text-green-600">
                      {(selectedFile.size / 1024).toFixed(1)} KB
                    </p>
                  </div>
                )}
              </div>

              <div className="grid gap-3">
                <Label htmlFor="uploadFileName">Name (Optional)</Label>
                <Input
                  id="uploadFileName"
                  value={fileName}
                  onChange={(e) => setFileName(e.target.value)}
                  placeholder="Enter custom name or keep original"
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
                <Button
                  type="button"
                  onClick={handleSubmit}
                  disabled={isLoading || !selectedFile}
                >
                  {isLoading ? 'Uploading...' : 'Upload File'}
                </Button>
              </DialogFooter>
            </div>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
