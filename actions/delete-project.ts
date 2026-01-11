'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { z } from 'zod';

const DeleteProject = z.object({
  projectId: z.string().uuid('Invalid project ID'),
});

export type State = {
  projectId: string | null;
  message?: string | null;
  success?: boolean;
};

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

    const projectFolderPath = `projects/${validatedProjectId}`;

    const { data: storageFiles, error: listError } = await supabase.storage
      .from('octree')
      .list(projectFolderPath);

    if (listError) {
      console.error('Error listing storage files:', listError);
    } else if (storageFiles && storageFiles.length > 0) {
      const filePaths = storageFiles.map(
        (file) => `${projectFolderPath}/${file.name}`
      );

      const { error: storageDeleteError } = await supabase.storage
        .from('octree')
        .remove(filePaths);

      if (storageDeleteError) {
        console.error('Error deleting storage files:', storageDeleteError);
        throw new Error('Failed to delete project files from storage');
      }
    }

    const { error: documentsError } = await supabase
      .from('documents')
      .delete()
      .eq('project_id', validatedProjectId);

    if (documentsError) {
      console.error('Error deleting project documents:', documentsError);
      throw new Error('Failed to delete project documents');
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
