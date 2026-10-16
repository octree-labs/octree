import { NextResponse } from 'next/server';
import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);

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
    const { data, error } = await resend.emails.send({
      from: 'basil@useoctree.online',
      to: 'basil@useoctree.online',
      replyTo: email,
      subject: `Contact Form: ${subject}`,
      html: `
        <h2>New Contact Form Submission</h2>
        <p><strong>Name:</strong> ${name}</p>
        <p><strong>Email:</strong> ${email}</p>
        <p><strong>Subject:</strong> ${subject}</p>
        <hr />
        <p><strong>Message:</strong></p>
        <p>${message.replace(/\n/g, '<br>')}</p>
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


