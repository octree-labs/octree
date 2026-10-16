'use server';

import { createClient } from '@/lib/supabase/server';
import { TablesInsert } from '@/database.types';
import { revalidatePath } from 'next/cache';

interface CreateProjectFromLatexResult {
  projectId: string | null;
  error: string | null;
}

export async function createProjectFromLatex(
  title: string,
  latexContent: string
): Promise<CreateProjectFromLatexResult> {
  try {
    const supabase = await createClient();

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      return { projectId: null, error: 'Not authenticated' };
    }

    const sanitizedTitle = title.trim() || 'Untitled Document';

    const projectData: TablesInsert<'projects'> = {
      title: sanitizedTitle,
      user_id: user.id,
    };

    const { data: project, error: projectError } = await (
      supabase.from('projects') as ReturnType<typeof supabase.from>
    )
      .insert(projectData)
      .select()
      .single();

    if (projectError || !project) {
      console.error('Failed to create project:', projectError);
      return { projectId: null, error: 'Failed to create project' };
    }

    const filePath = `projects/${project.id}/main.tex`;

    const { error: uploadError } = await supabase.storage
      .from('octree')
      .upload(filePath, latexContent, {
        contentType: 'text/x-tex',
        upsert: false,
      });

    if (uploadError) {
      console.error('Failed to upload file:', uploadError);
      await supabase.from('projects').delete().eq('id', project.id);
      return { projectId: null, error: 'Failed to save document' };
    }

    const { data: urlData } = supabase.storage
      .from('octree')
      .getPublicUrl(filePath);

    const fileRecord: TablesInsert<'files'> = {
      project_id: project.id,
      name: 'main.tex',
      type: 'text/x-tex',
      size: new Blob([latexContent]).size,
      url: urlData.publicUrl,
    };

    const { error: fileError } = await (
      supabase.from('files') as ReturnType<typeof supabase.from>
    ).insert(fileRecord);

    if (fileError) {
      console.error('Failed to create file record:', fileError);
    }

    revalidatePath('/');
    revalidatePath('/projects');

    return { projectId: project.id, error: null };
  } catch (err) {
    console.error('Unexpected error creating project:', err);
    return {
      projectId: null,
      error: err instanceof Error ? err.message : 'Unexpected error',
    };
  }
}
