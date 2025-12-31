import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';

interface InvitationWithProject {
  id: string;
  project_id: string;
  role: string;
  invited_by: string;
  expires_at: string;
  projects: { title: string; user_id: string } | null;
}

// GET /api/invitations/[token] - Get invitation details
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await params;
    const supabaseAdmin = createAdminClient();

    // Get invitation with project details - use admin to bypass RLS
    const { data: invitationData, error } = await supabaseAdmin
      .from('project_invitations')
      .select('*, projects(title, user_id)')
      .eq('token', token)
      .is('accepted_at', null)
      .single();

    const invitation = invitationData as InvitationWithProject | null;

    if (error || !invitation) {
      console.log('Get invitation - not found:', error);
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

    // Get inviter details
    const { data: inviterData } = await supabaseAdmin.auth.admin.getUserById(
      invitation.invited_by
    );

    const inviterName =
      inviterData?.user?.user_metadata?.name ||
      inviterData?.user?.email ||
      'Unknown';

    const project = invitation.projects;

    return NextResponse.json({
      project_title: project?.title || 'Unknown Project',
      inviter_name: inviterName,
      role: invitation.role,
      expires_at: invitation.expires_at,
    });
  } catch (error) {
    console.error('Error in GET invitation:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

