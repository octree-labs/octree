import 'server-only';

import type { TablesInsert } from '@/database.types';
import type { createClient } from '@/lib/supabase/server';
import {
  MAX_ACTIVE_API_KEYS,
  apiKeyDisplayPrefix,
  generateApiKey,
  hashApiKey,
  normalizeApiKeyName,
} from '@/lib/api/keys';
import { AnalyticsEvents } from '@/lib/analytics/events';
import { captureServerEventAfterResponse } from '@/lib/posthog-server';

/**
 * Creates an API key for a signed-in user with their own session (RLS +
 * column grants in migration 20261109000000_api_keys.sql; the 5-key cap is
 * also enforced by the api_keys_guard trigger). Shared by Settings > API
 * (actions/api-keys.ts) and device approvals (actions/device-activate.ts).
 * The plaintext is returned once and never stored or logged here.
 */

export interface ApiKeySummary {
  id: string;
  name: string;
  key_prefix: string;
  created_at: string;
  last_used_at: string | null;
}

export type CreateKeyFailure = 'invalid_name' | 'limit' | 'failed';

export type CreateKeyForUserResult =
  | { ok: true; key: string; summary: ApiKeySummary }
  | { ok: false; reason: CreateKeyFailure; error: string };

export const API_KEY_SUMMARY_COLUMNS = 'id, name, key_prefix, created_at, last_used_at';

const LIMIT_MESSAGE = `You can have at most ${MAX_ACTIVE_API_KEYS} active keys. Revoke one first.`;

type SessionClient = Awaited<ReturnType<typeof createClient>>;

export async function createApiKeyForUser(
  supabase: SessionClient,
  userId: string,
  name: string
): Promise<CreateKeyForUserResult> {
  const cleanName = normalizeApiKeyName(name);
  if (!cleanName) return { ok: false, reason: 'invalid_name', error: 'Give the key a name (1 to 64 characters).' };

  const { count, error: countError } = await supabase
    .from('api_keys')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .is('revoked_at', null);
  if (countError) {
    console.error('[api-keys] count failed:', countError.message);
    return { ok: false, reason: 'failed', error: 'Could not create the key. Try again.' };
  }
  if ((count ?? 0) >= MAX_ACTIVE_API_KEYS) return { ok: false, reason: 'limit', error: LIMIT_MESSAGE };

  const key = generateApiKey();
  const keyPrefix = apiKeyDisplayPrefix(key);
  const insertRow: TablesInsert<'api_keys'> = {
    user_id: userId,
    name: cleanName,
    key_prefix: keyPrefix,
    key_hash: hashApiKey(key),
  };
  // No RETURNING: key_hash is not selectable by users, so the row is read
  // back by prefix. (`as any`: the SSR client's insert/update typing, as in
  // actions/create-project.ts.)
  const { error } = await (supabase.from('api_keys') as any).insert(insertRow);
  if (error) {
    console.error('[api-keys] insert failed:', error.message);
    return /limit reached/i.test(error.message)
      ? { ok: false, reason: 'limit', error: LIMIT_MESSAGE }
      : { ok: false, reason: 'failed', error: 'Could not create the key. Try again.' };
  }

  const { data: row } = await supabase
    .from('api_keys')
    .select(API_KEY_SUMMARY_COLUMNS)
    .eq('user_id', userId)
    .eq('key_prefix', keyPrefix)
    .is('revoked_at', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  captureServerEventAfterResponse(userId, AnalyticsEvents.API_KEY_CREATED, {
    active_keys: (count ?? 0) + 1,
  });

  return {
    ok: true,
    key,
    summary: (row as ApiKeySummary | null) ?? {
      id: '',
      name: cleanName,
      key_prefix: keyPrefix,
      created_at: new Date().toISOString(),
      last_used_at: null,
    },
  };
}
