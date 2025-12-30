import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

interface Invitation {
  id: string;
  project_id: string;
  email: string | null;
  token: string;
  role: string;
  invited_by: string;
  expires_at: string;
  accepted_at: string | null;
}

// POST /api/invitations/[token]/accept - Accept an invitation
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await params;
    const supabase = await createClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json(
        { error: 'You must be logged in to accept an invitation' },
        { status: 401 }
      );
    }

    // Get the invitation
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: invitationData, error: inviteError } = await (supabase as any)
      .from('project_invitations')
      .select('*')
      .eq('token', token)
      .is('accepted_at', null)
      .single() as { data: Invitation | null; error: unknown };

    const invitation = invitationData;

    if (inviteError || !invitation) {
      return NextResponse.json(
        { error: 'Invitation not found or already used' },
        { status: 404 }
      );
    }

    // Check if invitation is expired
    if (new Date(invitation.expires_at) < new Date()) {
      return NextResponse.json(
        { error: 'This invitation has expired' },
        { status: 410 }
      );
    }

    // Check if user is already a collaborator
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: existingCollab } = await (supabase as any)
      .from('project_collaborators')
      .select('id')
      .eq('project_id', invitation.project_id)
      .eq('user_id', user.id)
      .single() as { data: { id: string } | null };

    if (existingCollab) {
      // Mark invitation as accepted anyway
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (supabase as any)
        .from('project_invitations')
        .update({ accepted_at: new Date().toISOString() })
        .eq('id', invitation.id);

      return NextResponse.json({
        success: true,
        project_id: invitation.project_id,
        message: 'You already have access to this project',
      });
    }

    // Check if user is the project owner
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: project } = await (supabase as any)
      .from('projects')
      .select('user_id')
      .eq('id', invitation.project_id)
      .single() as { data: { user_id: string } | null };

    if (project?.user_id === user.id) {
      return NextResponse.json(
        { error: 'You are the owner of this project' },
        { status: 400 }
      );
    }

    // Add user as collaborator
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: collabError } = await (supabase as any)
      .from('project_collaborators')
      .insert({
        project_id: invitation.project_id,
        user_id: user.id,
        role: invitation.role,
        invited_by: invitation.invited_by,
      });

    if (collabError) {
      console.error('Error adding collaborator:', collabError);
      return NextResponse.json(
        { error: 'Failed to add you as a collaborator' },
        { status: 500 }
      );
    }

    // Mark invitation as accepted
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase as any)
      .from('project_invitations')
      .update({ accepted_at: new Date().toISOString() })
      .eq('id', invitation.id);

    return NextResponse.json({
      success: true,
      project_id: invitation.project_id,
    });
  } catch (error) {
    console.error('Error in POST accept invitation:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

