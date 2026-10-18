import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { stripe } from '@/lib/stripe';
import { isCronRequestAuthorized } from '@/lib/ops/config';
import { buildDailyDigest } from '@/lib/ops/digest';
import { digestSubject, renderDigestHtml } from '@/lib/ops/digest-email';
import { sendOpsEmail } from '@/lib/ops/alert-email';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/**
 * Daily revenue + funnel digest. Scheduled in `vercel.json` (13:00 UTC).
 * `?dry=1` computes everything but skips the email.
 */
export async function GET(request: Request) {
  if (!isCronRequestAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const dry = new URL(request.url).searchParams.get('dry') === '1';

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  try {
    const digest = await buildDailyDigest({ stripe, supabase });
    const subject = digestSubject(digest);
    const email = dry ? { sent: false as const, reason: 'dry run' } : await sendOpsEmail({ subject, html: renderDigestHtml(digest) });
    return NextResponse.json({ subject, email, digest });
  } catch (error) {
    console.error('[ops] daily digest failed:', error);
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
