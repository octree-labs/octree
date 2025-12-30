import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

interface Project {
  id: string;
  user_id: string;
}

interface Collaborator {
  id: string;
  project_id: string;
  user_id: string;
  role: string;
  created_at: string;
}

// GET /api/projects/[projectId]/collaborators - List collaborators
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  try {
    const { projectId } = await params;
    const supabase = await createClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Verify user has access to this project
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: project } = await (supabase as any)
      .from('projects')
      .select('id, user_id')
      .eq('id', projectId)
      .single() as { data: Project | null };

    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    const isOwner = project.user_id === user.id;

    if (!isOwner) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: collaboration } = await (supabase as any)
        .from('project_collaborators')
        .select('id')
        .eq('project_id', projectId)
        .eq('user_id', user.id)
        .single() as { data: { id: string } | null };

      if (!collaboration) {
        return NextResponse.json({ error: 'Access denied' }, { status: 403 });
      }
    }

    // Get all collaborators
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: collaborators, error } = await (supabase as any)
      .from('project_collaborators')
      .select('*')
      .eq('project_id', projectId)
      .order('created_at', { ascending: true }) as { data: Collaborator[] | null; error: unknown };

    if (error) {
      console.error('Error fetching collaborators:', error);
      return NextResponse.json(
        { error: 'Failed to fetch collaborators' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      collaborators: collaborators || [],
      is_owner: isOwner,
      owner_id: project.user_id,
    });
  } catch (error) {
    console.error('Error in GET collaborators:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// DELETE /api/projects/[projectId]/collaborators - Remove a collaborator
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  try {
    const { projectId } = await params;
    const { userId } = await request.json();

    if (!userId) {
      return NextResponse.json(
        { error: 'User ID is required' },
        { status: 400 }
      );
    }

    const supabase = await createClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Verify user is project owner
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: project } = await (supabase as any)
      .from('projects')
      .select('user_id')
      .eq('id', projectId)
      .single() as { data: { user_id: string } | null };

    if (!project || project.user_id !== user.id) {
      return NextResponse.json(
        { error: 'Only project owners can remove collaborators' },
        { status: 403 }
      );
    }

    // Don't allow removing the owner
    if (userId === project.user_id) {
      return NextResponse.json(
        { error: 'Cannot remove project owner' },
        { status: 400 }
      );
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase as any)
      .from('project_collaborators')
      .delete()
      .eq('project_id', projectId)
      .eq('user_id', userId);

    if (error) {
      console.error('Error removing collaborator:', error);
      return NextResponse.json(
        { error: 'Failed to remove collaborator' },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error in DELETE collaborator:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
