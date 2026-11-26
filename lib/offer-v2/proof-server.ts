import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * The proof line's number: projects created on Octree in the last 7 days,
 * a plain `count` on projects.created_at with the service-role client.
 * Cached per process for CACHE_TTL_MS so the plan step costs one query an
 * hour per instance. Null on any error (the line is then not shown).
 * Never throws.
 */

const CACHE_TTL_MS = 60 * 60 * 1000;
const WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

let cached: { count: number | null; expires: number } | null = null;

export function resetProofCacheForTests(): void {
  cached = null;
}

export async function projectsCreatedLastWeek(
  admin: SupabaseClient<any, any, any>,
  now: number = Date.now()
): Promise<number | null> {
  if (cached && cached.expires > now) return cached.count;
  try {
    const since = new Date(now - WINDOW_MS).toISOString();
    const { count, error } = await admin
      .from('projects')
      .select('id', { count: 'exact', head: true })
      .gte('created_at', since);
    if (error) throw error;
    const value = typeof count === 'number' ? count : null;
    cached = { count: value, expires: now + CACHE_TTL_MS };
    return value;
  } catch (error) {
    console.error('[offer-v2] proof count failed:', error);
    return null;
  }
}
