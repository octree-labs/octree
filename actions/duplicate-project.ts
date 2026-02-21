'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { Tables, TablesInsert } from '@/database.types';
import { z } from 'zod';

const DuplicateProject = z.object({
  projectId: z.string().uuid('Invalid project ID'),
});

export type State = {
  projectId: string | null;
  message?: string | null;
  success?: boolean;
};

interface StorageFile {
  name: string;
  id: string | null;
  metadata?: { size?: number; mimetype?: string };
  created_at?: string;
}

async function listAllStorageFiles(
  supabase: Awaited<ReturnType<typeof createClient>>,
  projectId: string,
  path: string = ''
): Promise<StorageFile[]> {
  const listPath = path
    ? `projects/${projectId}/${path}`
    : `projects/${projectId}`;

  const { data: items, error } = await supabase.storage
    .from('octree')
    .list(listPath, {
      sortBy: { column: 'created_at', order: 'desc' },
    });

  if (error || !items) return [];

  const allFiles: StorageFile[] = [];

  for (const item of items) {
    if (item.id) {
      const fullPath = path ? `${path}/${item.name}` : item.name;
      allFiles.push({ ...item, name: fullPath });
    } else if (item.name !== '.emptyFolderPlaceholder') {
      const subPath = path ? `${path}/${item.name}` : item.name;
      const subFiles = await listAllStorageFiles(supabase, projectId, subPath);
      allFiles.push(...subFiles);
    }
  }

  return allFiles;
}

export async function duplicateProject(projectId: string): Promise<State> {
  try {
    const supabase = await createClient();

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      redirect('/auth/login');
    }

    const validatedFields = DuplicateProject.safeParse({ projectId });

    if (!validatedFields.success) {
      throw new Error(validatedFields.error.errors[0].message);
    }

    const { projectId: validatedProjectId } = validatedFields.data;

    const { data: sourceProjectData, error: projectError } = await supabase
      .from('projects')
      .select('*')
      .eq('id', validatedProjectId)
      .eq('user_id', user.id)
      .single();

    if (projectError || !sourceProjectData) {
      throw new Error(
        'Project not found or you do not have permission to duplicate it'
      );
    }

    const sourceProject = sourceProjectData as Tables<'projects'>;

    const sourceFiles = await listAllStorageFiles(supabase, validatedProjectId);

    const newProjectData: TablesInsert<'projects'> = {
      title: `${sourceProject.title} copy`,
      user_id: user.id,
    };

    const { data: newProject, error: createError } = await (
      supabase.from('projects') as any
    )
      .insert(newProjectData)
      .select()
      .single();

    if (createError || !newProject) {
      throw new Error('Failed to create duplicate project');
    }

    for (const file of sourceFiles) {
      const sourcePath = `projects/${validatedProjectId}/${file.name}`;
      const destPath = `projects/${newProject.id}/${file.name}`;

      const { data: fileBlob, error: downloadError } = await supabase.storage
        .from('octree')
        .download(sourcePath);

      if (downloadError || !fileBlob) {
        console.error(`Error downloading file ${file.name}:`, downloadError);
        continue;
      }

      const { error: uploadError } = await supabase.storage
        .from('octree')
        .upload(destPath, fileBlob, {
          cacheControl: '3600',
          upsert: false,
          contentType: file.metadata?.mimetype || undefined,
        });

      if (uploadError) {
        console.error(`Error uploading file ${file.name}:`, uploadError);
      }
    }

    revalidatePath('/');

    return {
      projectId: newProject.id,
      message: null,
      success: true,
    };
  } catch (error) {
    console.error('Error duplicating project:', error);
    return {
      projectId: null,
      message:
        error instanceof Error ? error.message : 'Failed to duplicate project',
      success: false,
    };
  }
}
