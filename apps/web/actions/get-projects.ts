'use server';

import { createClient } from '@/lib/supabase/server';
import type { Tables } from '@/database.types';

export async function getAllProjects(): Promise<Tables<'projects'>[] | null> {
  const supabase = await createClient();

  const { data } = await supabase
    .from('projects')
    .select('*')
    .order('updated_at', { ascending: false });

  return data;
}

export async function getProjectById(
  projectId: string
): Promise<Pick<Tables<'projects'>, 'title'> | null> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return null;
  }

  const { data } = await supabase
    .from('projects' as const)
    .select('title')
    .eq('id', projectId)
    .eq('user_id', user.id)
    .single<Pick<Tables<'projects'>, 'title'>>();

  return data;
}
