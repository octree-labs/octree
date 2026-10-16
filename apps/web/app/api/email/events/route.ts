import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { inngest } from '@/lib/inngest/client';

const ALLOWED_EVENTS = ['user/signed-in'] as const;
type AllowedEvent = (typeof ALLOWED_EVENTS)[number];

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { name } = await request.json();

  if (!ALLOWED_EVENTS.includes(name as AllowedEvent)) {
    return NextResponse.json({ error: 'Unknown event' }, { status: 400 });
  }

  await inngest.send({ name, data: { email: user.email } });

  return NextResponse.json({ ok: true });
}
