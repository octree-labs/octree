import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { isCronRequestAuthorized } from '@/lib/ops/config';
import { cleanupApiArtifacts } from '@/lib/api/artifacts';
import { cleanupDeviceAuthorizations, type DeviceCleanupResult } from '@/lib/device/store';
import { cleanupOAuth, type OAuthCleanupResult } from '@/lib/oauth/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Deletes compiled API PDFs (bucket `api-artifacts`, lib/api/artifacts.ts)
 * older than 24 hours, and tidies device authorizations (lib/device/store.ts:
 * revokes keys approved for requests that expired uncollected, deletes rows
 * a day past expiry), and purges OAuth state (lib/oauth/store.ts
 * cleanupOAuth: spent codes, old refresh tokens and access keys, idle
 * grants and clients). Scheduled hourly in `vercel.json`; `?dry=1` counts
 * what would be deleted without deleting.
 */
export async function GET(request: Request) {
  if (!isCronRequestAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const dry = new URL(request.url).searchParams.get('dry') === '1';
  const admin = createAdminClient();
  const now = new Date();
  // Independent of the PDF cleanup: a failure here (e.g. the migration not
  // applied yet) is reported but does not fail the run.
  let device: DeviceCleanupResult | { error: string };
  try {
    device = await cleanupDeviceAuthorizations(admin, now, dry);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown error';
    console.error('[cron/api-artifacts] device cleanup failed:', message);
    device = { error: message };
  }
  let oauth: OAuthCleanupResult | { error: string };
  try {
    oauth = await cleanupOAuth(admin, now, dry);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown error';
    console.error('[cron/api-artifacts] oauth cleanup failed:', message);
    oauth = { error: message };
  }
  try {
    const result = await cleanupApiArtifacts(admin, now, dry);
    return NextResponse.json({ ok: true, dry, ...result, device, oauth });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown error';
    console.error('[cron/api-artifacts] cleanup failed:', message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
