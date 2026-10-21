import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import type { CheckoutOfferId } from '@/lib/checkout-offers';
import { hasUnlimitedEdits } from '@/lib/paywall';
import {
  firstPurchaseOfferFor,
  type FirstPurchaseOfferContext,
  type FirstPurchaseOfferRow,
} from '@/lib/first-purchase-offer';

/**
 * True when the user has a one-off purchase on record (credit pack or
 * single generation). Both ledgers are service-role only, so `admin` is
 * the service-role client. Two `limit 1` existence reads, in parallel, on
 * the user_id indexes (credit_purchases_user_id_idx,
 * generation_purchases_user_id_idx). Throws on a query error: the caller
 * fails closed.
 */
async function hasOneOffPurchase(admin: SupabaseClient<any, any, any>, userId: string): Promise<boolean> {
  const [credits, generations] = await Promise.all([
    admin.from('credit_purchases').select('id').eq('user_id', userId).limit(1),
    admin.from('generation_purchases').select('id').eq('user_id', userId).limit(1),
  ]);
  if (credits.error) throw credits.error;
  if (generations.error) throw generations.error;
  return (credits.data?.length ?? 0) > 0 || (generations.data?.length ?? 0) > 0;
}

/**
 * `firstPurchaseOfferFor` with the purchase ledgers consulted. The ledgers
 * are read only for a row that already passes every other check (a free
 * user who never paid), so paying users cost no extra query. No Stripe
 * call. Any failure means no offer.
 */
export async function resolveFirstPurchaseOffer(
  admin: SupabaseClient<any, any, any>,
  userId: string,
  row: FirstPurchaseOfferRow | null | undefined,
  context: Omit<FirstPurchaseOfferContext, 'hasPurchaseHistory'> & { now?: Date } = {}
): Promise<CheckoutOfferId | null> {
  const { now = new Date(), ...rest } = context;
  if (!firstPurchaseOfferFor(row, now, rest)) return null;
  try {
    const hasPurchaseHistory = await hasOneOffPurchase(admin, userId);
    return firstPurchaseOfferFor(row, now, { ...rest, hasPurchaseHistory });
  } catch (error) {
    console.error('[first-purchase-offer] purchase ledger lookup failed:', error);
    return null;
  }
}

/**
 * The first-purchase offer for the signed-in user of a server-rendered page
 * (/buy), by the same rule GET /api/subscription-status uses: the
 * user_usage row, the allowlist and the ledgers (no Stripe call). One
 * user_usage read, plus the two ledger reads only for an eligible row.
 * Rendered into the page, so /buy needs no client round trip to know.
 * Never throws; any failure is no offer.
 */
export async function firstPurchaseOfferForUser(
  supabase: SupabaseClient<any, any, any>,
  getAdmin: () => SupabaseClient<any, any, any>,
  user: { id: string; email?: string | null },
  now: Date = new Date()
): Promise<CheckoutOfferId | null> {
  try {
    const { data: row, error } = await supabase.from('user_usage').select('*').eq('user_id', user.id).maybeSingle();
    if (error) throw error;
    const hasUnlimited = hasUnlimitedEdits(user.email);
    if (!firstPurchaseOfferFor(row, now, { hasUnlimited })) return null;
    return await resolveFirstPurchaseOffer(getAdmin(), user.id, row, { hasUnlimited, now });
  } catch (error) {
    console.error('[first-purchase-offer] eligibility check failed:', error);
    return null;
  }
}
