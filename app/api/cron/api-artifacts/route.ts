import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { isCronRequestAuthorized } from '@/lib/ops/config';
import { cleanupApiArtifacts } from '@/lib/api/artifacts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Deletes compiled API PDFs (bucket `api-artifacts`, lib/api/artifacts.ts)
 * older than 24 hours. Scheduled hourly in `vercel.json`; `?dry=1` counts
 * what would be deleted without deleting.
 */
export async function GET(request: Request) {
  if (!isCronRequestAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const dry = new URL(request.url).searchParams.get('dry') === '1';
  try {
    const result = await cleanupApiArtifacts(createAdminClient(), new Date(), dry);
    return NextResponse.json({ ok: true, dry, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown error';
    console.error('[cron/api-artifacts] cleanup failed:', message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
