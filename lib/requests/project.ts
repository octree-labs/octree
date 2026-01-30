import { createClient } from '@/lib/supabase/client';
import type { ProjectFile } from '@/hooks/use-file-editor';
import { isBinaryFile } from '@/lib/constants/file-types';

export const getProject = async (projectId: string) => {
  const supabase = createClient();

  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session?.user) {
    throw new Error('User not authenticated');
  }

  const { data, error } = await supabase
    .from('projects')
    .select('*')
    .eq('id', projectId)
    .eq('user_id', session.user.id)
    .single();

  if (error) throw error;
  return data;
};

async function listAllFiles(
  supabase: any,
  projectId: string,
  path: string = ''
): Promise<any[]> {
  const listPath = path
    ? `projects/${projectId}/${path}`
    : `projects/${projectId}`;

  const { data: items, error } = await supabase.storage
    .from('octree')
    .list(listPath, {
      sortBy: { column: 'created_at', order: 'desc' },
    });

  if (error || !items) return [];

  const allFiles: any[] = [];

  for (const item of items) {
    if (item.id) {
      const fullPath = path ? `${path}/${item.name}` : item.name;
      allFiles.push({
        ...item,
        name: fullPath,
      });
    } else if (item.name !== '.emptyFolderPlaceholder') {
      const subPath = path ? `${path}/${item.name}` : item.name;
      const subFiles = await listAllFiles(supabase, projectId, subPath);
      allFiles.push(...subFiles);
    }
  }

  return allFiles;
}

export const getProjectFiles = async (
  projectId: string
): Promise<ProjectFile[]> => {
  const supabase = createClient();

  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session?.user) {
    throw new Error('User not authenticated');
  }

  const storageFiles = await listAllFiles(supabase, projectId);

  if (!storageFiles || storageFiles.length === 0) return [];

  const actualFiles = storageFiles.filter((item) => item.id !== null);

  const filesWithContent = await Promise.all(
    actualFiles.map(async (storageFile) => {
      try {
        const cacheBuster = `?t=${Date.now()}`;
        const { data: fileBlob, error: downloadError } = await supabase.storage
          .from('octree')
          .download(`projects/${projectId}/${storageFile.name}${cacheBuster}`);

        if (downloadError || !fileBlob) {
          console.warn(
            `Failed to download file ${storageFile.name}:`,
            downloadError
          );
          return {
            file: {
              id: storageFile.id,
              name: storageFile.name,
              project_id: projectId,
              size: null,
              type: null,
              uploaded_at: storageFile.created_at,
            },
            document: null,
          };
        }

        let content: string;
        if (isBinaryFile(storageFile.name)) {
          const arrayBuffer = await fileBlob.arrayBuffer();
          const uint8Array = new Uint8Array(arrayBuffer);
          // Convert to base64 in chunks to avoid stack overflow with large files
          let binary = '';
          const chunkSize = 32768; // Process 32KB at a time
          for (let i = 0; i < uint8Array.length; i += chunkSize) {
            const chunk = uint8Array.subarray(i, i + chunkSize);
            binary += String.fromCharCode.apply(null, chunk as unknown as number[]);
          }
          content = btoa(binary);
        } else {
          content = await fileBlob.text();
        }

        return {
          file: {
            id: storageFile.id,
            name: storageFile.name,
            project_id: projectId,
            size: storageFile.metadata?.size || null,
            type: storageFile.metadata?.mimetype || null,
            uploaded_at: storageFile.created_at,
          },
          document: {
            id: storageFile.id,
            title: storageFile.name,
            content: content,
            owner_id: session.user.id,
            project_id: projectId,
            filename: storageFile.name,
            document_type: storageFile.name === 'main.tex' ? 'article' : 'file',
            created_at: storageFile.created_at,
            updated_at: storageFile.updated_at || storageFile.created_at,
          },
        };
      } catch (error) {
        console.error(`Error processing file ${storageFile.name}:`, error);
        return {
          file: {
            id: storageFile.id,
            name: storageFile.name,
            project_id: projectId,
            size: null,
            type: null,
            uploaded_at: storageFile.created_at,
          },
          document: null,
        };
      }
    })
  );

  return filesWithContent.filter((item) => item.document !== null);
};

export interface ImportProjectResponse {
  success: boolean;
  projectId?: string;
  totalFiles?: number;
  texFiles?: number;
  otherFiles?: number;
  error?: string;
}

/**
 * Import a project from a ZIP file.
 * 
 * This uses a two-step process to bypass Vercel's 4.5MB body size limit:
 * 1. Upload the ZIP directly to Supabase Storage from the client
 * 2. Call the API with the storage path for processing
 */
export const importProject = async (
  file: File
): Promise<ImportProjectResponse> => {
  const supabase = createClient();

  // Check authentication
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session?.user) {
    return {
      success: false,
      error: 'Not authenticated',
    };
  }

  // Generate a unique temp path for the upload
  const tempId = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  const tempPath = `temp-imports/${session.user.id}/${tempId}/${file.name}`;

  try {
    // Step 1: Upload ZIP directly to Supabase Storage (bypasses Vercel limit)
    const { error: uploadError } = await supabase.storage
      .from('octree')
      .upload(tempPath, file, {
        cacheControl: '3600',
        upsert: false,
      });

    if (uploadError) {
      console.error('Failed to upload ZIP to storage:', uploadError);
      return {
        success: false,
        error: 'Failed to upload file. Please try again.',
      };
    }

    // Step 2: Call API with the storage path (small JSON payload)
    const response = await fetch('/api/import-project', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        storagePath: tempPath,
        fileName: file.name,
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      // Clean up temp file on error
      await supabase.storage.from('octree').remove([tempPath]);
      return {
        success: false,
        error: data.error || 'Failed to import project',
      };
    }

    return data;
  } catch (error) {
    // Clean up temp file on error
    await supabase.storage.from('octree').remove([tempPath]).catch(() => {});
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to import project',
    };
  }
};

export const renameFile = async (
  projectId: string,
  currentName: string,
  newName: string
): Promise<void> => {
  const supabase = createClient();

  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session?.user) {
    throw new Error('User not authenticated');
  }

  const { error: moveError } = await supabase.storage
    .from('octree')
    .move(
      `projects/${projectId}/${currentName}`,
      `projects/${projectId}/${newName}`
    );

  if (moveError) {
    throw new Error('Failed to rename file');
  }
};

export const deleteFile = async (
  projectId: string,
  fileId: string,
  fileName: string
): Promise<void> => {
  const supabase = createClient();

  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session?.user) {
    throw new Error('User not authenticated');
  }

  const { error: deleteError } = await supabase.storage
    .from('octree')
    .remove([`projects/${projectId}/${fileName}`]);

  if (deleteError) {
    throw new Error('Failed to delete file');
  }
};

export const createFolder = async (
  projectId: string,
  folderPath: string
): Promise<void> => {
  const supabase = createClient();

  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session?.user) {
    throw new Error('User not authenticated');
  }

  const gitkeepPath = `${folderPath}/.gitkeep`;
  const blob = new Blob([''], { type: 'text/plain' });

  const { error: uploadError } = await supabase.storage
    .from('octree')
    .upload(`projects/${projectId}/${gitkeepPath}`, blob, {
      cacheControl: '3600',
      upsert: false,
      contentType: 'text/plain',
    });

  if (uploadError) {
    throw new Error('Failed to create folder');
  }
};

export const renameFolder = async (
  projectId: string,
  currentPath: string,
  newPath: string
): Promise<void> => {
  const supabase = createClient();

  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session?.user) {
    throw new Error('User not authenticated');
  }

  const { data: files, error: listError } = await supabase.storage
    .from('octree')
    .list(`projects/${projectId}`, {
      search: currentPath,
    });

  if (listError || !files) {
    throw new Error('Failed to list folder contents');
  }

  const filesToMove = files.filter((file) =>
    file.name.startsWith(currentPath + '/')
  );

  for (const file of filesToMove) {
    const relativePath = file.name.substring(currentPath.length + 1);
    const oldPath = `projects/${projectId}/${currentPath}/${relativePath}`;
    const newFilePath = `projects/${projectId}/${newPath}/${relativePath}`;

    const { error: moveError } = await supabase.storage
      .from('octree')
      .move(oldPath, newFilePath);

    if (moveError) {
      throw new Error(`Failed to move file: ${file.name}`);
    }
  }

  const gitkeepOldPath = `projects/${projectId}/${currentPath}/.gitkeep`;
  const gitkeepNewPath = `projects/${projectId}/${newPath}/.gitkeep`;

  const { error: gitkeepMoveError } = await supabase.storage
    .from('octree')
    .move(gitkeepOldPath, gitkeepNewPath);

  if (gitkeepMoveError) {
    throw new Error('Failed to rename folder');
  }
};

async function listFolderFiles(
  supabase: any,
  projectId: string,
  folderPath: string
): Promise<string[]> {
  const basePath = `projects/${projectId}/${folderPath}`;
  const filePaths: string[] = [];

  async function listRecursive(path: string): Promise<void> {
    const { data: items, error } = await supabase.storage
      .from('octree')
      .list(path);

    if (error || !items) return;

    for (const item of items) {
      const itemPath = `${path}/${item.name}`;
      if (item.id) {
        // It's a file
        filePaths.push(itemPath);
      } else {
        // It's a folder, recurse into it
        await listRecursive(itemPath);
      }
    }
  }

  await listRecursive(basePath);
  return filePaths;
}

export const deleteFolder = async (
  projectId: string,
  folderPath: string
): Promise<void> => {
  const supabase = createClient();

  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session?.user) {
    throw new Error('User not authenticated');
  }

  // Get all files in the folder recursively
  const filePaths = await listFolderFiles(supabase, projectId, folderPath);

  if (filePaths.length === 0) {
    // Try to delete just the .gitkeep placeholder
    const { error } = await supabase.storage
      .from('octree')
      .remove([`projects/${projectId}/${folderPath}/.gitkeep`]);

    if (error) {
      throw new Error('Failed to delete folder');
    }
    return;
  }

  // Delete all files in the folder
  const { error: deleteError } = await supabase.storage
    .from('octree')
    .remove(filePaths);

  if (deleteError) {
    throw new Error('Failed to delete folder contents');
  }
};
