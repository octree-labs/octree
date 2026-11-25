'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { z } from 'zod';
import { previewPath } from '@/lib/utils/project-preview-path';

const DeleteProject = z.object({
  projectId: z.string().uuid('Invalid project ID'),
});

export type State = {
  projectId: string | null;
  message?: string | null;
  success?: boolean;
};

/** Full paths of every object under `folder`, walking subfolders (list() is one level). */
async function listObjectPaths(
  supabase: Awaited<ReturnType<typeof createClient>>,
  folder: string
): Promise<string[]> {
  const { data: items, error } = await supabase.storage
    .from('octree')
    .list(folder, { limit: 1000 });

  if (error) {
    console.error('Error listing storage files:', error);
    return [];
  }

  const paths: string[] = [];
  for (const item of items ?? []) {
    const path = `${folder}/${item.name}`;
    if (item.id) paths.push(path);
    else paths.push(...(await listObjectPaths(supabase, path)));
  }
  return paths;
}

export async function deleteProject(projectId: string) {
  try {
    const supabase = await createClient();

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      redirect('/auth/login');
    }

    const validatedFields = DeleteProject.safeParse({
      projectId,
    });

    if (!validatedFields.success) {
      throw new Error(validatedFields.error.errors[0].message);
    }

    const { projectId: validatedProjectId } = validatedFields.data;

    const { data: project, error: projectError } = await supabase
      .from('projects')
      .select('id, title')
      .eq('id', validatedProjectId)
      .eq('user_id', user.id)
      .single();

    if (projectError || !project) {
      throw new Error(
        'Project not found or you do not have permission to delete it'
      );
    }

    // Every object, including those in subfolders: once the projects row is
    // gone the storage policies no longer let the user reach them.
    const filePaths = [
      previewPath(validatedProjectId),
      ...(await listObjectPaths(supabase, `projects/${validatedProjectId}`)),
    ];

    const { error: storageDeleteError } = await supabase.storage
      .from('octree')
      .remove(filePaths);

    if (storageDeleteError) {
      console.error('Error deleting storage files:', storageDeleteError);
      throw new Error('Failed to delete project files from storage');
    }

    const { error: filesError } = await supabase
      .from('files')
      .delete()
      .eq('project_id', validatedProjectId);

    if (filesError) {
      console.error('Error deleting project files:', filesError);
      throw new Error('Failed to delete project files');
    }

    const { error: deleteError } = await supabase
      .from('projects')
      .delete()
      .eq('id', validatedProjectId)
      .eq('user_id', user.id);

    if (deleteError) {
      console.error('Error deleting project:', deleteError);
      throw new Error('Failed to delete project');
    }

    revalidatePath('/');

    return {
      projectId: validatedProjectId,
      message: null,
      success: true,
    };
  } catch (error) {
    console.error('Error deleting project:', error);
    return {
      projectId: null,
      message:
        error instanceof Error ? error.message : 'Failed to delete project',
      success: false,
    };
  }
}
