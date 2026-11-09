'use server';

import { revalidatePath } from 'next/cache';
import type { TablesInsert } from '@/database.types';
import { createClient } from '@/lib/supabase/server';
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
 * API keys for the public compile API and MCP server (Settings > API).
 * Rows are written with the user's own session (RLS + column grants in
 * migration 20261109000000_api_keys.sql); the key is generated and hashed
 * here, and the plaintext is returned once, never stored or logged.
 */

export interface ApiKeySummary {
  id: string;
  name: string;
  key_prefix: string;
  created_at: string;
  last_used_at: string | null;
}

export type CreateApiKeyResult =
  | { ok: true; key: string; summary: ApiKeySummary }
  | { ok: false; error: string };

const SUMMARY_COLUMNS = 'id, name, key_prefix, created_at, last_used_at';

async function currentUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return { supabase, user };
}

/** Active (not revoked) keys of the signed-in user, newest first. */
export async function listApiKeys(): Promise<ApiKeySummary[]> {
  const { supabase, user } = await currentUser();
  if (!user) return [];
  const { data, error } = await supabase
    .from('api_keys')
    .select(SUMMARY_COLUMNS)
    .eq('user_id', user.id)
    .is('revoked_at', null)
    .order('created_at', { ascending: false });
  if (error) {
    console.error('[api-keys] list failed:', error.message);
    return [];
  }
  return data ?? [];
}

export async function createApiKey(name: string): Promise<CreateApiKeyResult> {
  const cleanName = normalizeApiKeyName(name);
  if (!cleanName) return { ok: false, error: 'Give the key a name (1 to 64 characters).' };

  const { supabase, user } = await currentUser();
  if (!user) return { ok: false, error: 'Please sign in again.' };

  const { count, error: countError } = await supabase
    .from('api_keys')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', user.id)
    .is('revoked_at', null);
  if (countError) {
    console.error('[api-keys] count failed:', countError.message);
    return { ok: false, error: 'Could not create the key. Try again.' };
  }
  if ((count ?? 0) >= MAX_ACTIVE_API_KEYS) {
    return { ok: false, error: `You can have at most ${MAX_ACTIVE_API_KEYS} active keys. Revoke one first.` };
  }

  const key = generateApiKey();
  const keyPrefix = apiKeyDisplayPrefix(key);
  const insertRow: TablesInsert<'api_keys'> = {
    user_id: user.id,
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
    const limit = /limit reached/i.test(error.message);
    return {
      ok: false,
      error: limit
        ? `You can have at most ${MAX_ACTIVE_API_KEYS} active keys. Revoke one first.`
        : 'Could not create the key. Try again.',
    };
  }

  const { data: row } = await supabase
    .from('api_keys')
    .select(SUMMARY_COLUMNS)
    .eq('user_id', user.id)
    .eq('key_prefix', keyPrefix)
    .is('revoked_at', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  captureServerEventAfterResponse(user.id, AnalyticsEvents.API_KEY_CREATED, {
    active_keys: (count ?? 0) + 1,
  });
  revalidatePath('/settings/account');

  return {
    ok: true,
    key,
    summary: row ?? {
      id: '',
      name: cleanName,
      key_prefix: keyPrefix,
      created_at: new Date().toISOString(),
      last_used_at: null,
    },
  };
}

export async function revokeApiKey(id: string): Promise<{ ok: boolean; error?: string }> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return { ok: false, error: 'Unknown key.' };
  const { supabase, user } = await currentUser();
  if (!user) return { ok: false, error: 'Please sign in again.' };

  const { error } = await (supabase.from('api_keys') as any)
    .update({ revoked_at: new Date().toISOString() })
    .eq('id', id)
    .eq('user_id', user.id)
    .is('revoked_at', null);
  if (error) {
    console.error('[api-keys] revoke failed:', error.message);
    return { ok: false, error: 'Could not revoke the key. Try again.' };
  }
  revalidatePath('/settings/account');
  return { ok: true };
}
