'use server';

import { createClient } from '@/lib/supabase/server';
import type { Tables } from '@/database.types';
import type { DashboardProject } from '@/types/project';
import { createSignedUrlMap } from '@/lib/storage/signed-urls';
import { previewPath } from '@/lib/utils/project-preview-path';

/**
 * The caller's projects, newest first, each with a signed thumbnail URL
 * (the `octree` bucket is private). Thumbnails are signed in batches of
 * MAX_PATHS_PER_SIGN_REQUEST (one request for most users); a project
 * without a thumbnail gets null.
 */
export async function getAllProjects(): Promise<DashboardProject[] | null> {
  const supabase = await createClient();

  const { data } = await supabase
    .from('projects')
    .select('*')
    .order('updated_at', { ascending: false });

  if (!data) return null;
  const projects = data as Tables<'projects'>[];

  const previews = await createSignedUrlMap(
    supabase,
    'octree',
    projects.map((p) => previewPath(p.id))
  );

  return projects.map((p) => ({
    ...p,
    preview_url: previews.get(previewPath(p.id)) ?? null,
  }));
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
