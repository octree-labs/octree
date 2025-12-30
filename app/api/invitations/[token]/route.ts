import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

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
    const supabase = await createClient();

    // Get invitation with project details
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: invitationData, error } = await (supabase as any)
      .from('project_invitations')
      .select('*, projects(title, user_id)')
      .eq('token', token)
      .is('accepted_at', null)
      .single() as { data: InvitationWithProject | null; error: unknown };

    const invitation = invitationData;

    if (error || !invitation) {
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
    const { data: inviterData } = await supabase.auth.admin.getUserById(
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

