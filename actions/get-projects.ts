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

  // Get projects user collaborates on - use raw query to bypass any RLS issues for debugging
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: collaborations, error: collabError } = await (supabase as any)
    .from('project_collaborators')
    .select('project_id, role, user_id')
    .eq('user_id', user.id) as { data: { project_id: string; role: string; user_id: string }[] | null; error: unknown };

  console.log('=== getAllProjects DEBUG ===');
  console.log('Current user ID:', user.id);
  console.log('Collaborations found:', JSON.stringify(collaborations, null, 2));
  console.log('Collaboration error:', collabError);
  console.log('Owned projects count:', ownedProjects.length);
  console.log('============================');

  // Filter out owner collaborations - only get shared projects where user is NOT the owner
  const ownedProjectIds = new Set(ownedProjects.map(p => p.id));
  const sharedCollaborations = collaborations?.filter(c => !ownedProjectIds.has(c.project_id)) ?? [];
  const sharedProjectIds = sharedCollaborations.map((c) => c.project_id);
  
  console.log('Shared project IDs (excluding owned):', sharedProjectIds);
  
  let sharedProjects: Tables<'projects'>[] = [];
  if (sharedProjectIds.length > 0) {
    const { data, error: sharedError } = await supabase
      .from('projects')
      .select('*')
      .in('id', sharedProjectIds)
      .order('updated_at', { ascending: false });
    console.log('Shared projects fetched:', data?.length, 'error:', sharedError);
    sharedProjects = data ?? [];
  }

  // Combine and mark ownership
  const owned: ProjectWithAccess[] = ownedProjects.map((p) => ({
    ...p,
    is_owner: true,
    role: 'owner' as const,
  }));

  const shared: ProjectWithAccess[] = sharedProjects.map((p) => {
    const collab = sharedCollaborations.find((c) => c.project_id === p.id);
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
