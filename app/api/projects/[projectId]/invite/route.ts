import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { Resend } from 'resend';
import { v4 as uuidv4 } from 'uuid';

const resend = new Resend(process.env.RESEND_API_KEY);

// Hardcoded for collaboration feature - TODO: use NEXT_PUBLIC_APP_URL when configured
const APP_URL = 'http://localhost:3000';

interface Project {
  title: string;
  user_id: string;
}

interface Invitation {
  id: string;
  project_id: string;
  email: string | null;
  token: string;
  role: string;
  created_at: string;
  expires_at: string;
  accepted_at: string | null;
}

// POST /api/projects/[projectId]/invite - Send email invitation
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  try {
    const { projectId } = await params;
    const { email } = await request.json();

    if (!email) {
      return NextResponse.json({ error: 'Email is required' }, { status: 400 });
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
      .select('title, user_id')
      .eq('id', projectId)
      .single() as { data: Project | null };

    if (!project || project.user_id !== user.id) {
      return NextResponse.json(
        { error: 'Only project owners can invite collaborators' },
        { status: 403 }
      );
    }

    // Check if there's an existing pending invitation
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: existingInvite } = await (supabase as any)
      .from('project_invitations')
      .select('id')
      .eq('project_id', projectId)
      .eq('email', email.toLowerCase())
      .is('accepted_at', null)
      .single() as { data: { id: string } | null };

    if (existingInvite) {
      return NextResponse.json(
        { error: 'An invitation has already been sent to this email' },
        { status: 400 }
      );
    }

    // Create invitation token
    const token = uuidv4();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: insertError } = await (supabase as any)
      .from('project_invitations')
      .insert({
        project_id: projectId,
        email: email.toLowerCase(),
        token,
        role: 'editor',
        invited_by: user.id,
      });

    if (insertError) {
      console.error('Error creating invitation:', insertError);
      return NextResponse.json(
        { error: 'Failed to create invitation' },
        { status: 500 }
      );
    }

    // Send invitation email
    const inviteUrl = `${APP_URL}/invite/${token}`;
    const inviterName = user.user_metadata?.name || user.email || 'Someone';

    let emailSent = false;
    let emailError: string | null = null;

    if (!process.env.RESEND_API_KEY) {
      console.error('RESEND_API_KEY is not configured');
      emailError = 'Email service not configured';
    } else {
      try {
        const emailResult = await resend.emails.send({
          from: 'Octree <basil@useoctree.online>',
          to: email,
          subject: `${inviterName} invited you to collaborate on "${project.title}"`,
          html: `
            <!DOCTYPE html>
            <html>
              <head>
                <meta charset="utf-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
              </head>
              <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
                <div style="text-align: center; margin-bottom: 30px;">
                  <h1 style="color: #2563eb; margin: 0;">Octree</h1>
                </div>
                
                <h2 style="color: #1f2937;">You've been invited to collaborate!</h2>
                
                <p style="color: #4b5563; line-height: 1.6;">
                  <strong>${inviterName}</strong> has invited you to collaborate on the project 
                  <strong>"${project.title}"</strong> in Octree.
                </p>
                
                <div style="text-align: center; margin: 30px 0;">
                  <a href="${inviteUrl}" 
                     style="background-color: #2563eb; color: white; padding: 12px 24px; 
                            text-decoration: none; border-radius: 6px; display: inline-block;
                            font-weight: 500;">
                    Accept Invitation
                  </a>
                </div>
                
                <p style="color: #6b7280; font-size: 14px;">
                  This invitation will expire in 7 days.
                </p>
                
                <p style="color: #6b7280; font-size: 14px;">
                  If you didn't expect this invitation, you can ignore this email.
                </p>
                
                <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 30px 0;">
                
                <p style="color: #9ca3af; font-size: 12px; text-align: center;">
                  Octree - AI-Powered LaTeX Editor
                </p>
              </body>
            </html>
          `,
        });
        emailSent = true;
      } catch (err) {
        console.error('Error sending invitation email:', err);
        emailError = err instanceof Error ? err.message : 'Failed to send email';
      }
    }

    return NextResponse.json({ 
      success: true, 
      token,
      emailSent,
      emailError,
      inviteUrl
    });
  } catch (error) {
    console.error('Error in POST invite:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// GET /api/projects/[projectId]/invite - List pending invitations
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
    const { data: invitations, error } = await (supabase as any)
      .from('project_invitations')
      .select('*')
      .eq('project_id', projectId)
      .is('accepted_at', null)
      .order('created_at', { ascending: false }) as { data: Invitation[] | null; error: unknown };

    if (error) {
      console.error('Error fetching invitations:', error);
      return NextResponse.json(
        { error: 'Failed to fetch invitations' },
        { status: 500 }
      );
    }

    return NextResponse.json({ invitations: invitations || [] });
  } catch (error) {
    console.error('Error in GET invitations:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// DELETE /api/projects/[projectId]/invite - Revoke an invitation
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  try {
    const { projectId } = await params;
    const { invitationId } = await request.json();

    if (!invitationId) {
      return NextResponse.json(
        { error: 'Invitation ID is required' },
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
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase as any)
      .from('project_invitations')
      .delete()
      .eq('id', invitationId)
      .eq('project_id', projectId);

    if (error) {
      console.error('Error revoking invitation:', error);
      return NextResponse.json(
        { error: 'Failed to revoke invitation' },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error in DELETE invitation:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
