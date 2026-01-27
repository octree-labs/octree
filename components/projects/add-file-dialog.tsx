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
import { FileActions } from '@/stores/file';
import { useFileUpload } from '@/hooks/use-file-upload';
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
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploadMode, setUploadMode] = useState<'create' | 'upload'>('create');

  const { uploadFile, createFile, isUploading, error: uploadError } = useFileUpload({
    projectId,
    onUploadComplete: () => {
      handleOpenChange(false);
      onFileAdded?.();
    }
  });

  // Local state for UI error handling (e.g. validtion)
  const [validationError, setValidationError] = useState<string | null>(null);

  // Combine errors
  const error = validationError || uploadError;

  const onDrop = (acceptedFiles: File[]) => {
    if (acceptedFiles.length > 0) {
      const file = acceptedFiles[0];
      setSelectedFile(file);
      setFileName(file.name);
      setUploadMode('upload');
      setValidationError(null);
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
    disabled: isUploading,
    noClick: true,
    noKeyboard: true,
  });

  const handleFileUpload = async () => {
    if (!selectedFile || !fileName.trim()) return;
    await uploadFile(selectedFile, targetFolder, fileName);
  };

  const handleCreateFile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!fileName.trim()) return;
    await createFile(fileName, fileContent || '', targetFolder);
  };

  const handleSubmit =
    uploadMode === 'upload' ? handleFileUpload : handleCreateFile;

  const handleOpenChange = (newOpen: boolean) => {
    setOpen(newOpen);
    if (!newOpen) {
      setFileName('');
      setFileContent('');
      setSelectedFile(null);
      setValidationError(null);
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
            <TabsTrigger value="create" disabled={isUploading}>
              <FileText className="h-4 w-4" />
              Create File
            </TabsTrigger>
            <TabsTrigger value="upload" disabled={isUploading}>
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
                  disabled={isUploading}
                >
                  Cancel
                </Button>
                <Button type="submit" disabled={isUploading}>
                  {isUploading ? 'Creating...' : 'Create File'}
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
                    isUploading && 'cursor-not-allowed opacity-50'
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
                        disabled={isUploading}
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
                  disabled={isUploading}
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  onClick={handleSubmit}
                  disabled={isUploading || !selectedFile}
                >
                  {isUploading ? 'Uploading...' : 'Upload File'}
                </Button>
              </DialogFooter>
            </div>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
