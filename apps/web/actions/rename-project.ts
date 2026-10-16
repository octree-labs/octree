'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/database.types';
import { z } from 'zod';

const RenameProject = z.object({
  projectId: z.string().uuid('Invalid project ID'),
  title: z.string().min(1, 'Title is required').max(200, 'Title is too long'),
});

export type RenameState = {
  projectId: string | null;
  title?: string | null;
  message?: string | null;
  success?: boolean;
};

export async function renameProject(
  prevState: RenameState,
  formData: FormData
) {
  try {
    const supabase = await createClient();

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      redirect('/auth/login');
    }

    const validatedFields = RenameProject.safeParse({
      projectId: formData.get('projectId') as string,
      title: formData.get('title') as string,
    });

    if (!validatedFields.success) {
      throw new Error(validatedFields.error.errors[0].message);
    }

    const { projectId, title } = validatedFields.data;

    // Ensure the project belongs to the user
    const { data: project, error: projectError } = await supabase
      .from('projects')
      .select('id')
      .eq('id', projectId)
      .eq('user_id', user.id)
      .single();

    if (projectError || !project) {
      throw new Error('Project not found or unauthorized');
    }

    const typedSupabase = supabase as unknown as SupabaseClient<Database>;
    const { error: updateError } = await typedSupabase
      .from('projects')
      .update({ title, updated_at: new Date().toISOString() })
      .eq('id', projectId)
      .eq('user_id', user.id);

    if (updateError) {
      console.error('Error renaming project:', updateError);
      throw new Error('Failed to rename project');
    }

    revalidatePath('/');

    return {
      projectId,
      title,
      message: null,
      success: true,
    } satisfies RenameState;
  } catch (error) {
    console.error('Error renaming project:', error);
    return {
      projectId: null,
      title: null,
      message:
        error instanceof Error ? error.message : 'Failed to rename project',
      success: false,
    } satisfies RenameState;
  }
}
