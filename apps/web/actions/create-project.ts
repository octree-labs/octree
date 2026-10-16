'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { TablesInsert } from '@/database.types';
import { z } from 'zod';
import { DEFAULT_LATEX_CONTENT } from '@/data/constants';

const CreateProject = z.object({
  title: z.string().min(1, 'Project title is required').trim(),
});

type State = {
  projectId: string | null;
  message?: string | null;
  success?: boolean;
};

export async function createProject(title: string) {
  try {
    const supabase = await createClient();

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      redirect('/auth/login');
    }

    const validatedFields = CreateProject.safeParse({
      title,
    });

    if (!validatedFields.success) {
      throw new Error(validatedFields.error.errors[0].message);
    }

    const { title: validatedTitle } = validatedFields.data;

    const projectData: TablesInsert<'projects'> = {
      title: validatedTitle,
      user_id: user.id,
    };

    const { data, error } = await (supabase.from('projects') as any)
      .insert(projectData)
      .select()
      .single();

    if (error) {
      console.error('Error creating project:', error);
      throw new Error('Failed to create project');
    }

    const defaultContent = DEFAULT_LATEX_CONTENT(validatedTitle);
    const filePath = `projects/${data.id}/main.tex`;

    const { error: storageError } = await supabase.storage
      .from('octree')
      .upload(filePath, defaultContent, {
        contentType: 'text/x-tex',
        upsert: false,
      });

    if (storageError) {
      console.error('Error uploading file to storage:', storageError);
      throw new Error('Failed to upload file to storage');
    }

    const { data: urlData } = supabase.storage
      .from('octree')
      .getPublicUrl(filePath);

    const fileToInsert: TablesInsert<'files'> = {
      project_id: data.id,
      name: 'main.tex',
      type: 'text/x-tex',
      size: defaultContent.length,
      url: urlData.publicUrl,
    };

    const { error: fileError } = await (supabase.from('files') as any).insert(
      fileToInsert
    );

    if (fileError) {
      console.error('Error creating file record:', fileError);
      throw new Error('Failed to create file record');
    }

    revalidatePath('/');

    return {
      projectId: data.id,
      message: null,
      success: true,
    };
  } catch (error) {
    console.error('Error creating project:', error);
    return {
      projectId: null,
      message:
        error instanceof Error ? error.message : 'Failed to create project',
    };
  }
}
