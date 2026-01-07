import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { v4 as uuidv4 } from 'uuid';

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';

interface ShareLink {
  token: string;
  created_at: string;
  expires_at: string;
}

// POST /api/projects/[projectId]/share-link - Generate a share link
export async function POST(
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

    // Verify user is project owner
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: project } = await (supabase as any)
      .from('projects')
      .select('user_id')
      .eq('id', projectId)
      .single() as { data: { user_id: string } | null };

    if (!project || project.user_id !== user.id) {
      return NextResponse.json(
        { error: 'Only project owners can generate share links' },
        { status: 403 }
      );
    }

    // Check for existing share link (invitation without email)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: existingLink } = await (supabase as any)
      .from('project_invitations')
      .select('token, created_at, expires_at')
      .eq('project_id', projectId)
      .is('email', null)
      .is('accepted_at', null)
      .single() as { data: ShareLink | null };

    if (existingLink) {
      const shareUrl = `${APP_URL}/invite/${existingLink.token}`;
      return NextResponse.json({
        url: shareUrl,
        token: existingLink.token,
        expires_at: existingLink.expires_at,
        existing: true,
      });
    }

    // Create new share link
    const token = uuidv4();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: insertError } = await (supabase as any)
      .from('project_invitations')
      .insert({
        project_id: projectId,
        email: null, // null email indicates it's a share link
        token,
        role: 'editor',
        invited_by: user.id,
      });

    if (insertError) {
      console.error('Error creating share link:', insertError);
      return NextResponse.json(
        { error: 'Failed to create share link' },
        { status: 500 }
      );
    }

    const shareUrl = `${APP_URL}/invite/${token}`;

    return NextResponse.json({
      url: shareUrl,
      token,
      existing: false,
    });
  } catch (error) {
    console.error('Error in POST share-link:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// GET /api/projects/[projectId]/share-link - Get existing share link
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

    // Verify user is project owner
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: project } = await (supabase as any)
      .from('projects')
      .select('user_id')
      .eq('id', projectId)
      .single() as { data: { user_id: string } | null };

    if (!project || project.user_id !== user.id) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: shareLink } = await (supabase as any)
      .from('project_invitations')
      .select('token, created_at, expires_at')
      .eq('project_id', projectId)
      .is('email', null)
      .is('accepted_at', null)
      .single() as { data: ShareLink | null };

    if (!shareLink) {
      return NextResponse.json({ url: null });
    }

    const shareUrl = `${APP_URL}/invite/${shareLink.token}`;

    return NextResponse.json({
      url: shareUrl,
      token: shareLink.token,
      expires_at: shareLink.expires_at,
    });
  } catch (error) {
    console.error('Error in GET share-link:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// DELETE /api/projects/[projectId]/share-link - Revoke share link
export async function DELETE(
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

    // Verify user is project owner
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: project } = await (supabase as any)
      .from('projects')
      .select('user_id')
      .eq('id', projectId)
      .single() as { data: { user_id: string } | null };

    if (!project || project.user_id !== user.id) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase as any)
      .from('project_invitations')
      .delete()
      .eq('project_id', projectId)
      .is('email', null);

    if (error) {
      console.error('Error revoking share link:', error);
      return NextResponse.json(
        { error: 'Failed to revoke share link' },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error in DELETE share-link:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
