'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { AnalyticsEvents } from '@/lib/analytics/events';
import { captureServerEventAfterResponse } from '@/lib/posthog-server';

/**
 * Connected apps (Settings > Account): the OAuth grants of the signed-in
 * user. Read and revoked with the user's own session (RLS + column grants
 * in migration 20261129000000_oauth_server.sql); revoking a grant revokes
 * its access tokens in the same transaction (trigger), and its refresh
 * token stops working because the token endpoint checks the grant.
 */

export interface OAuthGrantSummary {
  id: string;
  client_name: string | null;
  client_kind: 'dcr' | 'cimd';
  /** cimd: the host of the metadata document URL. */
  client_host: string | null;
  created_at: string;
  last_refreshed_at: string | null;
}

function hostOf(clientId: string): string | null {
  try {
    return new URL(clientId).host;
  } catch {
    return null;
  }
}

export async function listOAuthGrants(): Promise<OAuthGrantSummary[]> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return [];
  const { data, error } = await supabase
    .from('oauth_grants')
    .select('id, client_id, client_kind, client_name, created_at, last_refreshed_at')
    .eq('user_id', user.id)
    .is('revoked_at', null)
    .order('created_at', { ascending: false });
  if (error) {
    console.error('[oauth-grants] list failed:', error.message);
    return [];
  }
  // (Cast: the SSR client's select typing, as in actions/api-keys.ts callers.)
  const rows = (data ?? []) as Array<{
    id: string;
    client_id: string;
    client_kind: string;
    client_name: string | null;
    created_at: string;
    last_refreshed_at: string | null;
  }>;
  return rows.map((row) => ({
    id: row.id,
    client_name: row.client_name,
    client_kind: row.client_kind === 'cimd' ? 'cimd' : 'dcr',
    client_host: row.client_kind === 'cimd' ? hostOf(row.client_id) : null,
    created_at: row.created_at,
    last_refreshed_at: row.last_refreshed_at,
  }));
}

export async function revokeOAuthGrant(id: string): Promise<{ ok: boolean; error?: string }> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return { ok: false, error: 'Unknown app.' };
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Please sign in again.' };

  const { error } = await (supabase.from('oauth_grants') as any)
    .update({ revoked_at: new Date().toISOString(), revoked_reason: 'user' })
    .eq('id', id)
    .eq('user_id', user.id)
    .is('revoked_at', null);
  if (error) {
    console.error('[oauth-grants] revoke failed:', error.message);
    return { ok: false, error: 'Could not disconnect the app. Try again.' };
  }
  captureServerEventAfterResponse(user.id, AnalyticsEvents.OAUTH_TOKEN_REVOKED, { grant_id: id, by: 'user', what: 'grant' });
  revalidatePath('/settings/account');
  return { ok: true };
}
