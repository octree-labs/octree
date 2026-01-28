'use client';

import { useState } from 'react';
import { useDropzone } from 'react-dropzone';
import { Button } from '@/components/ui/button';
import { Upload } from 'lucide-react';
import { DialogClose, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { importProject } from '@/lib/requests/project';
import { useCreateProject } from '@/hooks/create-project-client';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

interface CreateProjectTabsProps {
  onSuccess: (projectId: string) => void;
  onError?: (error: string) => void;
}

export function CreateProjectTabs({
  onSuccess,
  onError,
}: CreateProjectTabsProps) {
  const [activeTab, setActiveTab] = useState('create');

  const [title, setTitle] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [uploadMode, setUploadMode] = useState<'zip' | 'folder'>('zip');
  const { createProjectWithRefresh } = useCreateProject();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;

    setIsLoading(true);
    setError(null);

    const result = await createProjectWithRefresh(title);

    if (result.success && result.projectId) {
      toast.success('Project created successfully!');
      setTitle('');
      onSuccess(result.projectId);
    } else {
      const errorMessage = result.message || 'Failed to create project';
      setError(errorMessage);
      onError?.(errorMessage);
    }

    setIsLoading(false);
  };

  const onDrop = (acceptedFiles: File[], rejectedFiles: any[]) => {
    if (rejectedFiles.length > 0) {
      const rejection = rejectedFiles[0];
      if (rejection.errors[0]?.code === 'file-too-large') {
        setError('File size must be less than 50MB');
      } else if (rejection.errors[0]?.code === 'file-invalid-type') {
        setError('Please select a ZIP file');
      } else {
        setError('Invalid file');
      }
      setSelectedFile(null);
      setSelectedFiles([]);
      return;
    }

    if (acceptedFiles.length > 0) {
      // Check if this is a folder upload (has webkitRelativePath) or ZIP
      const firstFile = acceptedFiles[0];
      if ((firstFile as any).webkitRelativePath || acceptedFiles.length > 1) {
        // Folder upload
        setSelectedFiles(acceptedFiles);
        setSelectedFile(null);
        setUploadMode('folder');
      } else if (firstFile.name.endsWith('.zip')) {
        // ZIP file
        setSelectedFile(firstFile);
        setSelectedFiles([]);
        setUploadMode('zip');
      } else {
        setError('Please select a ZIP file or folder');
        setSelectedFile(null);
        setSelectedFiles([]);
        return;
      }
      setError(null);
    }
  };

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'application/zip': ['.zip'],
    },
    maxSize: 50 * 1024 * 1024,
    multiple: true, // Allow multiple files for folder upload
    disabled: isLoading,
    noClick: true, // We'll handle clicks manually for folder selection
  });

  const handleFolderSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length > 0) {
      setSelectedFiles(files);
      setSelectedFile(null);
      setUploadMode('folder');
      setError(null);
    }
  };

  const handleZipSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (!file.name.endsWith('.zip')) {
        setError('Please select a ZIP file');
        return;
      }
      setSelectedFile(file);
      setSelectedFiles([]);
      setUploadMode('zip');
      setError(null);
    }
  };

  const handleImportSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedFile && selectedFiles.length === 0) {
      setError('Please select a ZIP file or folder');
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const data = await importProject(
        selectedFile || undefined,
        selectedFiles.length > 0 ? selectedFiles : undefined
      );

      if (!data.success) {
        throw new Error(data.error || 'Failed to import project');
      }

      if (data.success && data.projectId) {
        const message =
          data.otherFiles && data.otherFiles > 0
            ? `Project imported successfully! ${data.texFiles} LaTeX file(s) and ${data.otherFiles} other file(s).`
            : `Project imported successfully! ${data.texFiles} LaTeX file(s).`;
        toast.success(message);
        setSelectedFile(null);
        setSelectedFiles([]);
        onSuccess(data.projectId);
      }
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : 'Failed to import project';
      setError(errorMessage);
      onError?.(errorMessage);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
      <TabsList className="grid w-full grid-cols-2">
        <TabsTrigger value="create">Create New</TabsTrigger>
        <TabsTrigger value="import">Import Project</TabsTrigger>
      </TabsList>

      <TabsContent value="create" className="mt-4">
        <form onSubmit={handleSubmit} className="grid gap-4">
          <div className="grid gap-3">
            <Label htmlFor="title">Title</Label>
            <Input
              id="title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Enter project title"
              disabled={isLoading}
            />
            {error && <p className="text-sm text-red-600">{error}</p>}
          </div>

          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline" disabled={isLoading}>
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" disabled={isLoading || !title.trim()}>
              {isLoading ? 'Creating...' : 'Create'}
            </Button>
          </DialogFooter>
        </form>
      </TabsContent>
      <TabsContent value="import" className="mt-4">
        <form onSubmit={handleImportSubmit} className="grid gap-4">
          <div className="grid gap-4">
            <div className="grid gap-3">
              <Label>Import Options</Label>
              <div className="grid grid-cols-2 gap-3">
                <Button
                  type="button"
                  variant={uploadMode === 'zip' ? 'default' : 'outline'}
                  onClick={() => {
                    setUploadMode('zip');
                    setSelectedFile(null);
                    setSelectedFiles([]);
                    setError(null);
                  }}
                  disabled={isLoading}
                  className="w-full"
                >
                  ZIP File
                </Button>
                <Button
                  type="button"
                  variant={uploadMode === 'folder' ? 'default' : 'outline'}
                  onClick={() => {
                    setUploadMode('folder');
                    setSelectedFile(null);
                    setSelectedFiles([]);
                    setError(null);
                  }}
                  disabled={isLoading}
                  className="w-full"
                >
                  Folder
                </Button>
              </div>
            </div>

            {uploadMode === 'zip' ? (
              <div className="grid gap-3">
                <Label htmlFor="zipFile">ZIP File</Label>
                <div
                  {...getRootProps()}
                  className={cn(
                    'relative cursor-pointer rounded-lg border-2 border-dashed p-8 text-center transition-colors duration-200',
                    isDragActive
                      ? 'border-primary bg-primary/5'
                      : 'border-neutral-300 hover:border-neutral-400 hover:bg-neutral-50',
                    isLoading && 'cursor-not-allowed opacity-50'
                  )}
                >
                  <input
                    {...getInputProps()}
                    onChange={handleZipSelect}
                    accept=".zip"
                    type="file"
                  />

                  <div className="flex flex-col items-center gap-2">
                    <Upload
                      className={cn(
                        'h-10 w-10',
                        isDragActive ? 'text-primary' : 'text-neutral-400'
                      )}
                    />
                    <div className="text-sm">
                      <span className="font-medium text-primary">
                        Click to upload
                      </span>
                      <span className="text-neutral-600"> or drag and drop</span>
                    </div>
                    <p className="text-xs text-neutral-500">
                      ZIP files up to 50MB
                    </p>
                  </div>
                </div>

                {selectedFile && (
                  <div className="flex flex-col gap-3 rounded-md border border-neutral-200 bg-neutral-50 p-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden text-sm">
                      <div className="rounded bg-primary/10 p-1">
                        <Upload className="h-4 w-4 text-primary" />
                      </div>
                      <div className="min-w-0 max-w-full">
                        <p
                          className="block max-w-[220px] truncate font-medium text-neutral-900 sm:max-w-[320px]"
                          title={selectedFile.name}
                        >
                          {selectedFile.name}
                        </p>
                        <p className="text-xs text-neutral-500">
                          {(selectedFile.size / 1024 / 1024).toFixed(2)} MB
                        </p>
                      </div>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="self-end sm:self-auto"
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedFile(null);
                      }}
                      disabled={isLoading}
                    >
                      Remove
                    </Button>
                  </div>
                )}
              </div>
            ) : (
              <div className="grid gap-3">
                <Label htmlFor="folderFile">Folder</Label>
                <div
                  className={cn(
                    'relative cursor-pointer rounded-lg border-2 border-dashed p-8 text-center transition-colors duration-200',
                    isDragActive
                      ? 'border-primary bg-primary/5'
                      : 'border-neutral-300 hover:border-neutral-400 hover:bg-neutral-50',
                    isLoading && 'cursor-not-allowed opacity-50'
                  )}
                >
                  <input
                    id="folderFile"
                    type="file"
                    {...({ webkitdirectory: '', directory: '' } as any)}
                    multiple
                    onChange={handleFolderSelect}
                    disabled={isLoading}
                    className="absolute inset-0 cursor-pointer opacity-0"
                  />

                  <div className="flex flex-col items-center gap-2">
                    <Upload
                      className={cn(
                        'h-10 w-10',
                        isDragActive ? 'text-primary' : 'text-neutral-400'
                      )}
                    />
                    <div className="text-sm">
                      <span className="font-medium text-primary">
                        Click to select folder
                      </span>
                    </div>
                    <p className="text-xs text-neutral-500">
                      Select a folder containing LaTeX files (up to 50MB total)
                    </p>
                  </div>
                </div>

                {selectedFiles.length > 0 && (
                  <div className="flex flex-col gap-3 rounded-md border border-neutral-200 bg-neutral-50 p-3">
                    <div className="flex items-center justify-between">
                      <div className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden text-sm">
                        <div className="rounded bg-primary/10 p-1">
                          <Upload className="h-4 w-4 text-primary" />
                        </div>
                        <div className="min-w-0 max-w-full">
                          <p className="block font-medium text-neutral-900">
                            {selectedFiles.length} file(s) selected
                          </p>
                          <p className="text-xs text-neutral-500">
                            {(
                              selectedFiles.reduce((sum, f) => sum + f.size, 0) /
                              1024 /
                              1024
                            ).toFixed(2)}{' '}
                            MB total
                          </p>
                        </div>
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setSelectedFiles([]);
                        }}
                        disabled={isLoading}
                      >
                        Remove
                      </Button>
                    </div>
                    <div className="max-h-32 overflow-y-auto text-xs text-neutral-600">
                      <p className="font-medium mb-1">Files:</p>
                      <ul className="list-disc list-inside space-y-1">
                        {selectedFiles.slice(0, 10).map((file, idx) => (
                          <li key={idx} className="truncate">
                            {(file as any).webkitRelativePath || file.name}
                          </li>
                        ))}
                        {selectedFiles.length > 10 && (
                          <li className="text-neutral-500">
                            ... and {selectedFiles.length - 10} more
                          </li>
                        )}
                      </ul>
                    </div>
                  </div>
                )}
              </div>
            )}

            {error && <p className="text-sm text-red-600">{error}</p>}
          </div>

          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline" disabled={isLoading}>
                Cancel
              </Button>
            </DialogClose>
            <Button
              type="submit"
              disabled={isLoading || (!selectedFile && selectedFiles.length === 0)}
              className="gap-2"
            >
              {isLoading ? (
                'Importing...'
              ) : (
                <>
                  <Upload className="h-4 w-4" />
                  Import
                </>
              )}
            </Button>
          </DialogFooter>
        </form>
      </TabsContent>
    </Tabs>
  );
}
