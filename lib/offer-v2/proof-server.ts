import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * The proof line's number: projects created on Octree in the last 7 days,
 * a plain `count` on projects.created_at with the service-role client.
 * Cached per process for CACHE_TTL_MS; the query is bounded at TIMEOUT_MS so
 * the plan step never waits on it. A failure or timeout is null (the line
 * is skipped) and is not cached, so the next request tries again. Never
 * throws.
 */

const CACHE_TTL_MS = 60 * 60 * 1000;
const TIMEOUT_MS = 1500;
const WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

let cached: { count: number; expires: number } | null = null;

export function resetProofCacheForTests(): void {
  cached = null;
}

export async function projectsCreatedLastWeek(
  admin: SupabaseClient<any, any, any>,
  now: number = Date.now(),
  timeoutMs: number = TIMEOUT_MS
): Promise<number | null> {
  if (cached && cached.expires > now) return cached.count;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const since = new Date(now - WINDOW_MS).toISOString();
    const query = (async () => {
      const { count, error } = await admin
        .from('projects')
        .select('id', { count: 'exact', head: true })
        .gte('created_at', since);
      if (error) throw error;
      return typeof count === 'number' ? count : null;
    })();
    const timeout = new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), timeoutMs);
    });
    const count = await Promise.race([query, timeout]);
    if (count !== null) cached = { count, expires: now + CACHE_TTL_MS };
    return count;
  } catch (error) {
    console.error('[offer-v2] proof count failed:', error);
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}
