import { randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Compiled PDFs of the public API and the MCP server, handed out as
 * short-lived signed links so agents do not have to carry a base64 PDF in
 * their context.
 *
 * Bucket `api-artifacts` (supabase/migrations/20261127000000_api_artifacts.sql)
 * is private and has no storage policies: only the service role writes,
 * signs and deletes. Objects live at `<YYYY-MM-DD>/<user id>/<uuid>.pdf`
 * (UTC day of the upload) so the cleanup cron (app/api/cron/api-artifacts)
 * can walk whole days; each is deleted once it is older than
 * API_ARTIFACT_RETENTION_MS, well after its link has expired.
 */

export const API_ARTIFACTS_BUCKET = 'api-artifacts';
/** How long a signed PDF link works. */
export const API_ARTIFACT_URL_TTL_SECONDS = 60 * 60;
/** How long the object is kept (the link expires long before). */
export const API_ARTIFACT_RETENTION_MS = 24 * 60 * 60 * 1000;
/** Cap on deletions per cleanup run, so one run stays well inside its time limit. */
export const API_ARTIFACT_CLEANUP_MAX_DELETES = 5000;
/** Wall-clock budget of one cleanup run (the cron route's maxDuration is 60s). */
export const API_ARTIFACT_CLEANUP_BUDGET_MS = 45_000;
/**
 * Upload + sign must finish within this, or the caller gets null and falls
 * back to the inline PDF: a compile may already have used most of the
 * route's 120s maxDuration (API_COMPILE_TIMEOUT_MS is 100s), and a stalled
 * storage call must not turn a successful, already counted compile into a
 * killed request.
 */
export const API_ARTIFACT_STORE_TIMEOUT_MS = 10_000;

const LIST_PAGE = 1000;
const REMOVE_BATCH = 500;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 24 * 60 * 60 * 1000;

// Any Supabase client: the service-role client in production, a fake in tests.
type StorageClient = Pick<SupabaseClient, 'storage'>;

export interface StoredPdf {
  path: string;
  url: string;
  expires_at: string;
}

export function apiArtifactPath(userId: string, now: Date = new Date(), id: string = randomUUID()): string {
  return `${now.toISOString().slice(0, 10)}/${userId}/${id}.pdf`;
}

/**
 * Uploads one PDF and signs a link to it. Null on any storage failure or
 * after API_ARTIFACT_STORE_TIMEOUT_MS (the caller falls back to the inline
 * PDF); never throws.
 */
export async function storeApiPdf(
  client: StorageClient,
  userId: string,
  pdf: Uint8Array,
  now: Date = new Date(),
  timeoutMs: number = API_ARTIFACT_STORE_TIMEOUT_MS
): Promise<StoredPdf | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => {
      console.error(`[api-artifacts] store timed out after ${timeoutMs} ms`);
      resolve(null);
    }, timeoutMs);
  });
  try {
    return await Promise.race([uploadAndSign(client, userId, pdf, now), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

async function uploadAndSign(
  client: StorageClient,
  userId: string,
  pdf: Uint8Array,
  now: Date
): Promise<StoredPdf | null> {
  try {
    const path = apiArtifactPath(userId, now);
    const bucket = client.storage.from(API_ARTIFACTS_BUCKET);
    const { error: uploadError } = await bucket.upload(path, pdf, {
      contentType: 'application/pdf',
      upsert: false,
      cacheControl: '3600',
    });
    if (uploadError) {
      console.error('[api-artifacts] upload failed:', uploadError.message);
      return null;
    }
    const { data, error: signError } = await bucket.createSignedUrl(path, API_ARTIFACT_URL_TTL_SECONDS);
    if (signError || !data?.signedUrl) {
      console.error('[api-artifacts] signing failed:', signError?.message ?? 'no url');
      return null;
    }
    return {
      path,
      url: data.signedUrl,
      expires_at: new Date(now.getTime() + API_ARTIFACT_URL_TTL_SECONDS * 1000).toISOString(),
    };
  } catch (error) {
    console.error('[api-artifacts] store threw:', error instanceof Error ? error.message : 'unknown error');
    return null;
  }
}

interface ListedEntry {
  name: string;
  id: string | null;
  created_at?: string | null;
}

async function listAll(client: StorageClient, prefix: string): Promise<ListedEntry[]> {
  const out: ListedEntry[] = [];
  for (let offset = 0; ; offset += LIST_PAGE) {
    const { data, error } = await client.storage
      .from(API_ARTIFACTS_BUCKET)
      .list(prefix, { limit: LIST_PAGE, offset, sortBy: { column: 'name', order: 'asc' } });
    if (error) throw new Error(`list ${prefix || '/'} failed: ${error.message}`);
    const page = (data ?? []) as ListedEntry[];
    out.push(...page);
    if (page.length < LIST_PAGE) return out;
  }
}

export interface ApiArtifactCleanupResult {
  deleted: number;
  days_scanned: number;
  truncated: boolean;
}

/**
 * Deletes every object older than the retention window. Day folders that
 * ended more than a retention window ago are deleted whole; the most recent
 * expired day is checked object by object (`created_at`).
 */
export async function cleanupApiArtifacts(
  client: StorageClient,
  now: Date = new Date(),
  dryRun = false,
  budgetMs: number = API_ARTIFACT_CLEANUP_BUDGET_MS
): Promise<ApiArtifactCleanupResult> {
  const startedAt = Date.now();
  const cutoff = now.getTime() - API_ARTIFACT_RETENTION_MS;
  const result: ApiArtifactCleanupResult = { deleted: 0, days_scanned: 0, truncated: false };
  const days = (await listAll(client, '')).filter((e) => e.id === null && DAY_RE.test(e.name));

  // Deletes as it goes (one user folder at a time) so a run that hits the
  // deletion cap or the time budget has still removed what it found; the
  // next run picks up the rest.
  const stop = (): ApiArtifactCleanupResult => {
    result.truncated = true;
    return result;
  };

  for (const day of days) {
    const dayStart = Date.parse(`${day.name}T00:00:00.000Z`);
    if (Number.isNaN(dayStart) || dayStart >= cutoff) continue; // nothing in it is old enough yet
    const wholeDayExpired = dayStart + DAY_MS <= cutoff;
    result.days_scanned += 1;

    const users = (await listAll(client, day.name)).filter((e) => e.id === null);
    for (const user of users) {
      if (Date.now() - startedAt > budgetMs) return stop();
      const files = await listAll(client, `${day.name}/${user.name}`);
      const expired: string[] = [];
      for (const file of files) {
        if (file.id === null) continue;
        const created = file.created_at ? Date.parse(file.created_at) : NaN;
        if (wholeDayExpired || (!Number.isNaN(created) && created < cutoff)) {
          expired.push(`${day.name}/${user.name}/${file.name}`);
        }
      }

      for (let i = 0; i < expired.length; i += REMOVE_BATCH) {
        const room = API_ARTIFACT_CLEANUP_MAX_DELETES - result.deleted;
        if (room <= 0) return stop();
        const batch = expired.slice(i, i + Math.min(REMOVE_BATCH, room));
        if (!dryRun) {
          const { error } = await client.storage.from(API_ARTIFACTS_BUCKET).remove(batch);
          if (error) throw new Error(`remove failed: ${error.message}`);
        }
        result.deleted += batch.length;
        if (batch.length < Math.min(REMOVE_BATCH, expired.length - i)) return stop();
      }
    }
  }
  return result;
}
