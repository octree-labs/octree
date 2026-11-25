import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Helpers for reading objects from the private `octree` and
 * `chat-attachments` buckets. Safe to import from server and client: they
 * take the caller's Supabase client, so storage RLS decides what can be
 * signed (only the owner's objects).
 */

/** How long a signed URL handed to the browser stays valid. */
export const SIGNED_URL_TTL_SECONDS = 60 * 60;

/** Paths per createSignedUrls call, to keep each request body small. */
export const MAX_PATHS_PER_SIGN_REQUEST = 100;

type StorageClient = Pick<SupabaseClient, 'storage'>;

/**
 * Signs many object paths in one bucket with as few requests as possible.
 * Returns path → signed URL for every path that could be signed; paths
 * that are missing, not readable by the caller, or in a failed batch are
 * left out, so callers treat "absent" as "no image".
 */
export async function createSignedUrlMap(
  client: StorageClient,
  bucket: string,
  paths: readonly string[],
  expiresIn: number = SIGNED_URL_TTL_SECONDS
): Promise<Map<string, string>> {
  const unique = [...new Set(paths.filter(Boolean))];
  const signed = new Map<string, string>();
  if (unique.length === 0) return signed;

  const batches: string[][] = [];
  for (let i = 0; i < unique.length; i += MAX_PATHS_PER_SIGN_REQUEST) {
    batches.push(unique.slice(i, i + MAX_PATHS_PER_SIGN_REQUEST));
  }

  await Promise.all(
    batches.map(async (batch) => {
      try {
        const { data, error } = await client.storage
          .from(bucket)
          .createSignedUrls(batch, expiresIn);
        if (error || !data) {
          if (error) console.error(`Failed to sign ${bucket} URLs:`, error.message);
          return;
        }
        for (const item of data) {
          if (item.path && item.signedUrl && !item.error) {
            signed.set(item.path, item.signedUrl);
          }
        }
      } catch (error) {
        console.error(`Failed to sign ${bucket} URLs:`, error);
      }
    })
  );

  return signed;
}

/**
 * Object path inside `bucket` for a Supabase Storage URL
 * (`/storage/v1/object/{public,sign,authenticated}/<bucket>/<path>`), or
 * null for anything else (blob:, data:, another bucket, not a URL).
 * Rows written while the buckets were public stored such URLs.
 */
export function storagePathFromUrl(url: string | null | undefined, bucket: string): string | null {
  if (!url) return null;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }

  const match = parsed.pathname.match(/\/storage\/v1\/object\/(public|sign|authenticated)\/([^/]+)\/(.+)$/);
  if (!match) return null;
  const [, kind, rawBucket] = match;
  // getPublicUrl encodes with encodeURI, which leaves `?` and `#` in an
  // object name as they are, so on a public URL they belong to the path.
  // (Signed URLs carry `?token=`, which is not part of it.)
  const rawPath = kind === 'public' ? match[3] + parsed.search + parsed.hash : match[3];

  try {
    if (decodeURIComponent(rawBucket) !== bucket) return null;
    const path = rawPath
      .split('/')
      .map((segment) => decodeURIComponent(segment))
      .join('/');
    return path || null;
  } catch {
    return null;
  }
}
