'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { API_KEY_SUMMARY_COLUMNS, createApiKeyForUser, type ApiKeySummary } from '@/lib/api/create-key';

/**
 * API keys for the public compile API and MCP server (Settings > API).
 * Rows are written with the user's own session (RLS + column grants in
 * migration 20261109000000_api_keys.sql); the key is generated and hashed
 * in lib/api/create-key.ts, and the plaintext is returned once, never stored
 * or logged.
 */

export type { ApiKeySummary };

export type CreateApiKeyResult =
  | { ok: true; key: string; summary: ApiKeySummary }
  | { ok: false; error: string };

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
    .select(API_KEY_SUMMARY_COLUMNS)
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
  const { supabase, user } = await currentUser();
  if (!user) return { ok: false, error: 'Please sign in again.' };
  const result = await createApiKeyForUser(supabase, user.id, name);
  if (!result.ok) return { ok: false, error: result.error };
  revalidatePath('/settings/account');
  return { ok: true, key: result.key, summary: result.summary };
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
