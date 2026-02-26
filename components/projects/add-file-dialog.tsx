'use client';

import { useState, useEffect, useCallback } from 'react';
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
import { Plus, Upload, FileText, Link2, RefreshCw, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { createClient } from '@/lib/supabase/client';
import { useProjectFilesRevalidation } from '@/hooks/use-file-editor';
import { FileActions } from '@/stores/file';
import { FileTreeActions } from '@/stores/file-tree';
import { checkFileExists } from '@/lib/requests/project';
import {
  ALL_SUPPORTED_FILE_TYPES,
  MAX_BINARY_FILE_SIZE,
  getContentTypeByFilename,
} from '@/lib/constants/file-types';
import { toast } from 'sonner';
import { useZoteroSync } from '@/hooks/use-zotero-sync';

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
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [zoteroUrl, setZoteroUrl] = useState('');
  const [uploadMode, setUploadMode] = useState<'create' | 'upload' | 'zotero'>(
    'create'
  );
  const [uploadProgress, setUploadProgress] = useState<string | null>(null);
  const { revalidate } = useProjectFilesRevalidation(projectId);
  const { state: zoteroState, syncing, syncFromUrl, syncSaved } =
    useZoteroSync(projectId);

  useEffect(() => {
    setZoteroUrl(zoteroState.sourceUrl ?? '');
  }, [zoteroState.sourceUrl]);

  const onDrop = useCallback((acceptedFiles: File[]) => {
    if (acceptedFiles.length > 0) {
      setSelectedFiles(acceptedFiles);
      if (acceptedFiles.length === 1) {
        setFileName(acceptedFiles[0].name);
      } else {
        setFileName('');
      }
      setUploadMode('upload');
      setError(null);
    }
  }, []);

  const {
    getRootProps,
    getInputProps,
    isDragActive,
    open: openFileDialog,
  } = useDropzone({
    onDrop,
    accept: ALL_SUPPORTED_FILE_TYPES,
    maxSize: MAX_BINARY_FILE_SIZE,
    multiple: true,
    disabled: isLoading,
    noClick: true,
    noKeyboard: true,
  });

  const removeSelectedFile = (index: number) => {
    setSelectedFiles((prev) => {
      const updated = prev.filter((_, i) => i !== index);
      if (updated.length === 1) {
        setFileName(updated[0].name);
      } else if (updated.length === 0) {
        setFileName('');
      }
      return updated;
    });
  };

  const handleFileUpload = async () => {
    if (selectedFiles.length === 0) return;

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
      const totalFiles = selectedFiles.length;
      const errors: string[] = [];
      let firstUploadedFullPath: string | null = null;
      let firstUploadedName: string | null = null;
      const CONCURRENCY = 5;

      const uploadOne = async (file: File) => {
        const uploadName =
          totalFiles === 1 && fileName.trim() ? fileName.trim() : file.name;
        const fullPath = targetFolder
          ? `${targetFolder}/${uploadName}`
          : uploadName;

        try {
          const exists = await checkFileExists(projectId, fullPath);
          if (exists) {
            errors.push(`${uploadName}: already exists`);
            return;
          }

          const mimeType = getContentTypeByFilename(uploadName);
          const { error: uploadError } = await supabase.storage
            .from('octree')
            .upload(`projects/${projectId}/${fullPath}`, file, {
              cacheControl: '3600',
              upsert: false,
              contentType: mimeType,
            });

          if (uploadError) {
            errors.push(`${uploadName}: upload failed`);
            return;
          }

          uploadedCount++;
          if (!firstUploadedFullPath) {
            firstUploadedFullPath = fullPath;
            firstUploadedName = uploadName;
          }
        } catch {
          errors.push(`${uploadName}: unexpected error`);
        }

        setUploadProgress(`Uploaded ${uploadedCount} of ${totalFiles}`);
      };

      // Upload in parallel batches
      for (let i = 0; i < selectedFiles.length; i += CONCURRENCY) {
        const batch = selectedFiles.slice(i, i + CONCURRENCY);
        setUploadProgress(
          `Uploading ${Math.min(i + CONCURRENCY, totalFiles)} of ${totalFiles}...`
        );
        await Promise.all(batch.map(uploadOne));
      }

      // Select the first uploaded file
      if (firstUploadedFullPath && firstUploadedName) {
        const { data: storageFiles } = await supabase.storage
          .from('octree')
          .list(
            targetFolder
              ? `projects/${projectId}/${targetFolder}`
              : `projects/${projectId}`
          );

        const uploadedFile = storageFiles?.find(
          (f) => f.name === firstUploadedName
        );
        if (uploadedFile) {
          FileActions.setSelectedFile({
            id: uploadedFile.id,
            name: firstUploadedFullPath,
            project_id: projectId,
            size: uploadedFile.metadata?.size || null,
            type: uploadedFile.metadata?.mimetype || null,
            uploaded_at: uploadedFile.created_at,
          });
        }
      }

      handleOpenChange(false);
      onFileAdded?.();

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
        error instanceof Error ? error.message : 'Failed to upload files'
      );
    } finally {
      setIsLoading(false);
      setUploadProgress(null);
    }
  };

  const handleCreateFile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!fileName.trim()) return;

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

      const fullPath = targetFolder ? `${targetFolder}/${fileName}` : fileName;

      const exists = await checkFileExists(projectId, fullPath);
      if (exists) {
        throw new Error('A file with this name already exists');
      }

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
      FileTreeActions.setLoading(false);
      setError(error instanceof Error ? error.message : 'Failed to add file');
    } finally {
      setIsLoading(false);
    }
  };

  const handleSubmit =
    uploadMode === 'upload' ? handleFileUpload : handleCreateFile;

  const handleImportZotero = async () => {
    if (!zoteroUrl.trim()) {
      setError('Please enter a Zotero URL');
      return;
    }
    setError(null);
    try {
      const synced = await syncFromUrl(zoteroUrl);
      toast.success(`Imported ${synced.entries.length} Zotero reference(s)`);
      setUploadMode('zotero');
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Failed to import Zotero references'
      );
    }
  };

  const handleSyncZotero = async () => {
    setError(null);
    try {
      const synced = await syncSaved();
      toast.success(`Synced ${synced.entries.length} Zotero reference(s)`);
      setUploadMode('zotero');
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Failed to sync Zotero references'
      );
    }
  };

  const handleSaveZoteroToProject = async () => {
    if (!zoteroState.refsBib?.trim()) {
      setError('No imported references to save yet');
      return;
    }
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
      const refsMime = getContentTypeByFilename('refs.bib');
      const refsPath = `projects/${projectId}/refs.bib`;
      const refsBlob = new Blob([zoteroState.refsBib], { type: refsMime });
      const { error: refsUploadError } = await supabase.storage
        .from('octree')
        .upload(refsPath, refsBlob, {
          cacheControl: '3600',
          upsert: true,
          contentType: refsMime,
        });
      if (refsUploadError) {
        throw new Error('Failed to save refs.bib');
      }
      const mainPath = `projects/${projectId}/main.tex`;
      const { data: mainBlob } = await supabase.storage
        .from('octree')
        .download(mainPath);
      let patchedMainTex = false;
      if (mainBlob) {
        const mainText = await mainBlob.text();
        const hasBibStyle = /\\bibliographystyle\s*\{[^}]+\}/.test(mainText);
        const hasBibliography = /\\bibliography\s*\{[^}]+\}/.test(mainText);
        if (!hasBibStyle || !hasBibliography) {
          const additions = [
            !hasBibStyle ? '\\bibliographystyle{plain}' : null,
            !hasBibliography ? '\\bibliography{refs}' : null,
          ]
            .filter(Boolean)
            .join('\n');
          const insertion = `\n${additions}\n`;
          const endTag = '\\end{document}';
          const idx = mainText.lastIndexOf(endTag);
          const nextMain =
            idx >= 0
              ? `${mainText.slice(0, idx).trimEnd()}${insertion}${endTag}${mainText.slice(idx + endTag.length)}`
              : `${mainText.trimEnd()}${insertion}`;
          const mainMime = getContentTypeByFilename('main.tex');
          const { error: mainUploadError } = await supabase.storage
            .from('octree')
            .upload(mainPath, new Blob([nextMain], { type: mainMime }), {
              cacheControl: '3600',
              upsert: true,
              contentType: mainMime,
            });
          if (!mainUploadError) {
            patchedMainTex = true;
          }
        }
      }
      const { data: storageFiles } = await supabase.storage
        .from('octree')
        .list(`projects/${projectId}`);
      const refsFile = storageFiles?.find((f) => f.name === 'refs.bib');
      if (refsFile) {
        FileActions.setSelectedFile({
          id: refsFile.id,
          name: refsFile.name,
          project_id: projectId,
          size: refsFile.metadata?.size || null,
          type: refsFile.metadata?.mimetype || null,
          uploaded_at: refsFile.created_at,
        });
      }
      await revalidate();
      toast.success(
        patchedMainTex
          ? 'Saved refs.bib and updated bibliography commands in main.tex'
          : 'Saved refs.bib to project'
      );
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Failed to save references'
      );
    } finally {
      setIsLoading(false);
      FileTreeActions.setLoading(false);
    }
  };

  const handleOpenChange = (newOpen: boolean) => {
    setOpen(newOpen);
    if (!newOpen) {
      setFileName('');
      setFileContent('');
      setSelectedFiles([]);
      setZoteroUrl('');
      setError(null);
      setUploadMode('create');
      setUploadProgress(null);
    }
  };

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
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
          <DialogTitle className="break-all pr-8 leading-normal">
            Add File to {projectTitle}
          </DialogTitle>
          <DialogDescription>
            Create a new LaTeX file or upload files (PDFs, images, etc.) to this
            project.
          </DialogDescription>
        </DialogHeader>

        <Tabs
          value={uploadMode}
          onValueChange={(value) => setUploadMode(value as 'create' | 'upload' | 'zotero')}
        >
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="create" disabled={isLoading}>
              <FileText className="h-4 w-4" />
              Create File
            </TabsTrigger>
            <TabsTrigger value="upload" disabled={isLoading}>
              <Upload className="h-4 w-4" />
              Upload Files
            </TabsTrigger>
            <TabsTrigger value="zotero" disabled={isLoading}>
              <Link2 className="h-4 w-4" />
              Import Zotero
            </TabsTrigger>
          </TabsList>

          <TabsContent value="create" className="mt-4">
            <form onSubmit={handleCreateFile} className="grid gap-4">
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
                <Button type="submit" variant="gradient" disabled={isLoading}>
                  {isLoading ? 'Creating...' : 'Create File'}
                </Button>
              </DialogFooter>
            </form>
          </TabsContent>

          <TabsContent value="upload" className="mt-4">
            <div className="grid gap-4">
              <div className="grid gap-3">
                <Label htmlFor="fileUpload">Select Files</Label>
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
                      Select multiple files. Supports LaTeX, PDFs, images (max{' '}
                      {MAX_BINARY_FILE_SIZE / 1024 / 1024}MB each)
                    </p>
                  </div>
                </div>

                {selectedFiles.length > 0 && (
                  <div className="max-h-40 space-y-1.5 overflow-y-auto rounded-md border border-green-200 bg-green-50 p-3">
                    <p className="text-xs font-medium text-green-700">
                      {selectedFiles.length} file
                      {selectedFiles.length !== 1 ? 's' : ''} selected
                    </p>
                    {selectedFiles.map((file, index) => (
                      <div
                        key={`${file.name}-${index}`}
                        className="flex items-center justify-between gap-2 text-sm text-green-700"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-xs font-medium">
                            {file.name}
                          </p>
                          <p className="text-xs text-green-600">
                            {formatFileSize(file.size)}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => removeSelectedFile(index)}
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

              {selectedFiles.length === 1 && (
                <div className="grid gap-3">
                  <Label htmlFor="uploadFileName">Name (Optional)</Label>
                  <Input
                    id="uploadFileName"
                    value={fileName}
                    onChange={(e) => setFileName(e.target.value)}
                    placeholder="Enter custom name or keep original"
                  />
                </div>
              )}

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
                  onClick={handleSubmit}
                  disabled={isLoading || selectedFiles.length === 0}
                >
                  {isLoading
                    ? 'Uploading...'
                    : `Upload ${selectedFiles.length > 1 ? `${selectedFiles.length} Files` : 'File'}`}
                </Button>
              </DialogFooter>
            </div>
          </TabsContent>

          <TabsContent value="zotero" className="mt-4">
            <div className="grid gap-4">
              <div className="grid gap-3">
                <Label htmlFor="zoteroUrl">Public Zotero URL</Label>
                <Input
                  id="zoteroUrl"
                  value={zoteroUrl}
                  onChange={(e) => setZoteroUrl(e.target.value)}
                  placeholder="https://www.zotero.org/users/... or /groups/..."
                  disabled={syncing}
                />
                <p className="text-xs text-neutral-500">
                  Private library? Export a `.bib` file from Zotero and use Upload File.
                </p>
              </div>

              <div className="rounded-md border border-neutral-200 bg-neutral-50 p-3 text-xs text-neutral-700">
                <p>
                  Last sync:{' '}
                  {zoteroState.lastSyncedAt
                    ? new Date(zoteroState.lastSyncedAt).toLocaleString()
                    : 'Never'}
                </p>
                <p>References: {zoteroState.entries.length}</p>
                <p>Status: {zoteroState.lastSyncStatus}</p>
                {zoteroState.lastSyncError && (
                  <p className="text-red-600">Error: {zoteroState.lastSyncError}</p>
                )}
              </div>

              {error && <p className="text-sm text-red-600">{error}</p>}

              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => handleOpenChange(false)}
                  disabled={syncing}
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleSyncZotero}
                  disabled={syncing || !zoteroState.sourceUrl}
                >
                  <RefreshCw className={cn('h-4 w-4', syncing && 'animate-spin')} />
                  {syncing ? 'Syncing...' : 'Sync'}
                </Button>
                <Button
                  type="button"
                  variant="gradient"
                  onClick={handleImportZotero}
                  disabled={syncing || !zoteroUrl.trim()}
                >
                  <Link2 className="h-4 w-4" />
                  {syncing ? 'Importing...' : 'Import'}
                </Button>
                <Button
                  type="button"
                  variant="gradient"
                  onClick={handleSaveZoteroToProject}
                  disabled={isLoading || syncing || zoteroState.entries.length === 0}
                >
                  {isLoading ? 'Saving...' : 'Save to Project'}
                </Button>
              </DialogFooter>
            </div>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
