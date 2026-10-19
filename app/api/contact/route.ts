import { NextResponse } from 'next/server';
import { resend, FROM_ADDRESS } from '@/lib/email/client';

const CONTACT_INBOX =
  process.env.CONTACT_INBOX || process.env.OPS_ALERT_EMAIL || 'basil@useoctree.com';

function escapeHtml(value: unknown): string {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { name, email, subject, message } = body;

    // validate fields
    if (!name || !email || !subject || !message) {
      return NextResponse.json(
        { error: 'all fields are required' },
        { status: 400 }
      );
    }

    // send email via resend
    // Sent from the verified domain; delivered to the owner's inbox (the
    // old useoctree.online mailbox had no receiving record). Form fields are
    // visitor input, so they are escaped before going into the HTML body.
    const { data, error } = await resend.emails.send({
      from: FROM_ADDRESS,
      to: CONTACT_INBOX,
      replyTo: email,
      subject: `Contact Form: ${subject}`,
      html: `
        <h2>New Contact Form Submission</h2>
        <p><strong>Name:</strong> ${escapeHtml(name)}</p>
        <p><strong>Email:</strong> ${escapeHtml(email)}</p>
        <p><strong>Subject:</strong> ${escapeHtml(subject)}</p>
        <hr />
        <p><strong>Message:</strong></p>
        <p>${escapeHtml(message).replace(/\n/g, '<br>')}</p>
      `,
    });

    if (error) {
      console.error('error sending email via resend:', error);
      return NextResponse.json(
        { error: 'failed to send email' },
        { status: 500 }
      );
    }

    return NextResponse.json(
      { success: true, message: 'email sent successfully', data },
      { status: 200 }
    );
  } catch (error) {
    console.error('error processing contact submission:', error);
    return NextResponse.json(
      { error: 'internal server error' },
      { status: 500 }
    );
  }
}


