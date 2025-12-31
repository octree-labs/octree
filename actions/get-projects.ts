'use server';

import { createClient } from '@/lib/supabase/server';
import type { Tables } from '@/database.types';

export interface ProjectWithAccess extends Tables<'projects'> {
  is_owner: boolean;
  role: 'owner' | 'editor';
}

export async function getAllProjects(): Promise<ProjectWithAccess[] | null> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return null;
  }

  // Get projects user owns
  const { data: ownedProjectsData } = await supabase
    .from('projects')
    .select('*')
    .eq('user_id', user.id)
    .order('updated_at', { ascending: false });

  const ownedProjects: Tables<'projects'>[] = ownedProjectsData ?? [];

  // Get projects user collaborates on
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: collaborations, error: collabError } = await (supabase as any)
    .from('project_collaborators')
    .select('project_id, role')
    .eq('user_id', user.id)
    .neq('role', 'owner') as { data: { project_id: string; role: string }[] | null; error: unknown };

  console.log('getAllProjects - user:', user.id);
  console.log('getAllProjects - collaborations:', collaborations);
  console.log('getAllProjects - collabError:', collabError);

  const sharedProjectIds = collaborations?.map((c) => c.project_id) ?? [];
  
  let sharedProjects: Tables<'projects'>[] = [];
  if (sharedProjectIds.length > 0) {
    const { data } = await supabase
      .from('projects')
      .select('*')
      .in('id', sharedProjectIds)
      .order('updated_at', { ascending: false });
    sharedProjects = data ?? [];
  }

  // Combine and mark ownership
  const owned: ProjectWithAccess[] = ownedProjects.map((p) => ({
    ...p,
    is_owner: true,
    role: 'owner' as const,
  }));

  const shared: ProjectWithAccess[] = sharedProjects.map((p) => {
    const collab = collaborations?.find((c) => c.project_id === p.id);
    return {
      ...p,
      is_owner: false,
      role: (collab?.role as 'editor') ?? 'editor',
    };
  });

  // Merge and sort by updated_at
  return [...owned, ...shared].sort((a, b) => {
    const dateA = new Date(a.updated_at ?? a.created_at ?? 0).getTime();
    const dateB = new Date(b.updated_at ?? b.created_at ?? 0).getTime();
    return dateB - dateA;
  });
}

export async function getProjectById(
  projectId: string
): Promise<{ title: string; is_owner: boolean } | null> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return null;
  }

  // First check if user owns the project
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: ownedProject } = await (supabase as any)
    .from('projects')
    .select('title')
    .eq('id', projectId)
    .eq('user_id', user.id)
    .single() as { data: { title: string } | null };

  if (ownedProject) {
    return { title: ownedProject.title, is_owner: true };
  }

  // Check if user is a collaborator
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: collaboration } = await (supabase as any)
    .from('project_collaborators')
    .select('project_id')
    .eq('project_id', projectId)
    .eq('user_id', user.id)
    .single() as { data: { project_id: string } | null };

  if (collaboration) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: project } = await (supabase as any)
      .from('projects')
      .select('title')
      .eq('id', projectId)
      .single() as { data: { title: string } | null };

    if (project) {
      return { title: project.title, is_owner: false };
    }
  }

  return null;
}
