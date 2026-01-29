import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useProjectFilesRevalidation } from '@/hooks/use-file-editor';
import { FileActions } from '@/stores/file';
import { getContentTypeByFilename } from '@/lib/constants/file-types';
import { toast } from 'sonner';

interface UseFileUploadOptions {
  projectId: string;
  onUploadComplete?: () => void;
}

export function useFileUpload({ projectId, onUploadComplete }: UseFileUploadOptions) {
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { revalidate } = useProjectFilesRevalidation(projectId);

  const uploadFile = async (file: File, targetFolder: string | null = null, customName: string | null = null) => {
    setIsUploading(true);
    setError(null);

    try {
      const supabase = createClient();

      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session?.user) {
        throw new Error('User not authenticated');
      }

      const fileName = customName || file.name;
      const fullPath = targetFolder ? `${targetFolder}/${fileName}` : fileName;
      const mimeType = getContentTypeByFilename(fileName);

      const { error: uploadError } = await supabase.storage
        .from('octree')
        .upload(`projects/${projectId}/${fullPath}`, file, {
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
        // Optional: Select the file after upload if needed, or leave it to the caller
        // For now, we update the store if we found it
         FileActions.setSelectedFile({
          id: uploadedFile.id,
          name: uploadedFile.name,
          project_id: projectId,
          size: uploadedFile.metadata?.size || null,
          type: uploadedFile.metadata?.mimetype || null,
          uploaded_at: uploadedFile.created_at,
        });
      }

      await revalidate();
      toast.success(`File ${fileName} uploaded successfully`);
      onUploadComplete?.();
      return true;

    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Failed to upload file';
      setError(msg);
      toast.error(msg);
      return false;
    } finally {
      setIsUploading(false);
    }
  };

  const createFile = async (fileName: string, content: string, targetFolder: string | null = null) => {
       setIsUploading(true);
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
      
      toast.success(`File ${fileName} created successfully`);
      onUploadComplete?.();
      return true;
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Failed to create file';
      setError(msg);
      toast.error(msg);
      return false;
    } finally {
      setIsUploading(false);
    }
  }

  return {
    uploadFile,
    createFile,
    isUploading,
    error,
  };
}
