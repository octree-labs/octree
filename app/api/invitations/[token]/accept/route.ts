import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';

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
    const supabaseAdmin = createAdminClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json(
        { error: 'You must be logged in to accept an invitation' },
        { status: 401 }
      );
    }

    console.log('Accept invitation - user:', user.id, 'token:', token);

    // Get the invitation - use admin client to bypass RLS
    const { data: invitationData, error: inviteError } = await supabaseAdmin
      .from('project_invitations')
      .select('*')
      .eq('token', token)
      .is('accepted_at', null)
      .single();
    
    console.log('Accept invitation - found invitation:', invitationData, 'error:', inviteError);

    const invitation = invitationData as Invitation | null;

    if (inviteError || !invitation) {
      console.log('Accept invitation - invitation not found or already used');
      return NextResponse.json(
        { error: 'Invitation not found or already used' },
        { status: 404 }
      );
    }

    // Check if invitation is expired
    if (new Date(invitation.expires_at) < new Date()) {
      console.log('Accept invitation - invitation expired');
      return NextResponse.json(
        { error: 'This invitation has expired' },
        { status: 410 }
      );
    }

    // Check if user is already a collaborator - use admin to bypass RLS
    const { data: existingCollab } = await supabaseAdmin
      .from('project_collaborators')
      .select('id')
      .eq('project_id', invitation.project_id)
      .eq('user_id', user.id)
      .single();

    if (existingCollab) {
      console.log('Accept invitation - user already a collaborator');
      // Mark invitation as accepted anyway
      await supabaseAdmin
        .from('project_invitations')
        .update({ accepted_at: new Date().toISOString() })
        .eq('id', invitation.id);

      return NextResponse.json({
        success: true,
        project_id: invitation.project_id,
        message: 'You already have access to this project',
      });
    }

    // Check if user is the project owner - use admin to bypass RLS
    const { data: project } = await supabaseAdmin
      .from('projects')
      .select('user_id')
      .eq('id', invitation.project_id)
      .single();

    if (project?.user_id === user.id) {
      return NextResponse.json(
        { error: 'You are the owner of this project' },
        { status: 400 }
      );
    }

    // Add user as collaborator
    const { error: collabError } = await supabaseAdmin
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

    // Mark invitation as accepted - also use admin client
    await supabaseAdmin
      .from('project_invitations')
      .update({ accepted_at: new Date().toISOString() })
      .eq('id', invitation.id);
    
    console.log('Collaborator added successfully:', {
      project_id: invitation.project_id,
      user_id: user.id,
      role: invitation.role,
    });

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

