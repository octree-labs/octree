import { createClient } from '@/lib/supabase/client';
import type { PaywallReason } from '@/lib/analytics/events';
import type { ProFeature } from '@/lib/subscription/features';

/**
 * Paywall reasons that mark a free user as a warm lead. `monthly_limit` is a
 * Pro subscriber out of edits (they are offered credits, not Pro), so it is
 * not recorded.
 */
export function isLeadPaywallReason(reason: PaywallReason): boolean {
  return reason !== 'monthly_limit';
}

/**
 * Records that the paywall opened for the signed-in user (table
 * `paywall_hits`, migration 20261021120000). The daily lifecycle cron reads
 * it for the warm_lead_offer email. Fire-and-forget: never throws, so a
 * pending migration, an RLS refusal or a network error cannot reach the UI.
 */
export async function recordPaywallHit(feature: ProFeature, reason: PaywallReason): Promise<void> {
  try {
    if (!isLeadPaywallReason(reason)) return;
    const supabase = createClient();
    const {
      data: { session },
    } = await supabase.auth.getSession();
    const userId = session?.user?.id;
    if (!userId) return;
    // Cast like lib/requests/user.ts: the browser client's generics resolve
    // insert payloads to `never` with this @supabase/ssr version.
    const { error } = await (supabase.from('paywall_hits') as any).insert({ user_id: userId, feature, reason });
    if (error) console.warn('[paywall] could not record paywall hit:', error.message);
  } catch (error) {
    console.warn('[paywall] could not record paywall hit:', error);
  }
}
