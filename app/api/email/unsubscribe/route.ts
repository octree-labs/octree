import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import {
  generateUnsubscribeToken,
  getAppUrl,
  getUnsubscribeSecret,
  verifyUserUnsubscribeToken,
} from '@/lib/email/unsubscribe';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Two link formats land here (see lib/email/unsubscribe.ts):
 *
 *  - `?email=&token=`  legacy transactional emails: suppress the address.
 *  - `?token=`         lifecycle emails: the token names the user; set
 *                      email_preferences.marketing_opt_out, suppress their
 *                      current address, show a confirmation page.
 *
 * Mail clients send the RFC 8058 one-click POST to the same URL, so POST
 * behaves exactly like GET.
 */
export async function GET(request: Request) {
  return handle(request);
}

export async function POST(request: Request) {
  return handle(request);
}

async function handle(request: Request) {
  const { searchParams } = new URL(request.url);
  const email = searchParams.get('email');
  const token = searchParams.get('token');

  if (!token) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }

  if (email) return unsubscribeByEmail(email, token);
  return unsubscribeByUser(token);
}

async function unsubscribeByEmail(email: string, token: string) {
  if (!getUnsubscribeSecret()) {
    return NextResponse.json({ error: 'Invalid token' }, { status: 403 });
  }
  const expected = Buffer.from(generateUnsubscribeToken(email));
  const actual = Buffer.from(token);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    return NextResponse.json({ error: 'Invalid token' }, { status: 403 });
  }

  const supabase = createAdminClient();
  const { error } = await supabase
    .from('email_suppressions')
    .upsert({ email: email.toLowerCase() }, { onConflict: 'email' });

  if (error) {
    console.error('Failed to unsubscribe:', error);
    return NextResponse.json({ error: 'Failed to unsubscribe' }, { status: 500 });
  }

  return NextResponse.redirect(`${getAppUrl()}/unsubscribed`);
}

async function unsubscribeByUser(token: string) {
  const secret = getUnsubscribeSecret();
  const userId = secret ? verifyUserUnsubscribeToken(token, secret) : null;
  if (!userId) {
    return NextResponse.json({ error: 'Invalid token' }, { status: 403 });
  }

  const supabase = createAdminClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.admin.getUserById(userId);
  if (userError || !user) {
    // The account is gone; nothing left to opt out. Treat as done.
    return confirmationPage();
  }

  const { error: prefError } = await supabase
    .from('email_preferences')
    .upsert({ user_id: userId, marketing_opt_out: true, updated_at: new Date().toISOString() }, { onConflict: 'user_id' });
  if (prefError) {
    console.error('Failed to store email preference:', prefError);
    return NextResponse.json({ error: 'Failed to unsubscribe' }, { status: 500 });
  }

  if (user.email) {
    const { error: suppressError } = await supabase
      .from('email_suppressions')
      .upsert({ email: user.email.toLowerCase() }, { onConflict: 'email' });
    if (suppressError) {
      console.error('Failed to suppress address:', suppressError);
      return NextResponse.json({ error: 'Failed to unsubscribe' }, { status: 500 });
    }
  }

  return confirmationPage();
}

function confirmationPage() {
  const appUrl = getAppUrl();
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Unsubscribed</title>
</head>
<body style="margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;background:#ffffff;color:#0a0a0a;">
<main style="max-width:480px;margin:0 auto;padding:80px 16px;text-align:center;">
<h1 style="font-size:24px;font-weight:600;margin:0 0 12px;">You're unsubscribed</h1>
<p style="font-size:15px;line-height:1.6;color:#52525b;margin:0 0 24px;">No more product emails from Octree. Account emails (sign-in links, receipts) still arrive.</p>
<a href="${appUrl}/" style="font-size:14px;color:#1e66ff;text-decoration:underline;">Back to Octree</a>
</main>
</body>
</html>`;
  return new NextResponse(html, {
    status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
  });
}
