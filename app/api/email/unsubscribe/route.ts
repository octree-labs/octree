import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { generateUnsubscribeToken } from '@/lib/email/unsubscribe';

function createServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const email = searchParams.get('email');
  const token = searchParams.get('token');

  if (!email || !token) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }

  if (token !== generateUnsubscribeToken(email)) {
    return NextResponse.json({ error: 'Invalid token' }, { status: 403 });
  }

  const supabase = createServiceClient();
  const { error } = await supabase
    .from('email_suppressions')
    .upsert({ email: email.toLowerCase() }, { onConflict: 'email' });

  if (error) {
    console.error('Failed to unsubscribe:', error);
    return NextResponse.json({ error: 'Failed to unsubscribe' }, { status: 500 });
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://app.useoctree.com';
  return NextResponse.redirect(`${appUrl}/unsubscribed`);
}
