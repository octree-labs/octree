import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import type { CheckoutOfferId } from '@/lib/checkout-offers';
import { hasUnlimitedEdits } from '@/lib/paywall';
import { resolveStripeCustomer } from '@/lib/stripe-customer';
import {
  firstPurchaseOfferFor,
  type FirstPurchaseOfferContext,
  type FirstPurchaseOfferRow,
} from '@/lib/first-purchase-offer';

/**
 * True when the user has a one-off purchase on record (credit pack or
 * single generation). Both ledgers are service-role only, so `admin` is
 * the service-role client. Throws on a query error: the caller fails closed.
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
 * user who never paid), so paying users cost no extra query. Any failure
 * means no offer.
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
 * (/buy), with the same inputs GET /api/subscription-status uses: the
 * user_usage row, the allowlist, the Stripe customer (by stored id, then by
 * email) and the ledgers. Rendered into the page, so /buy needs no client
 * round trip to know. The Stripe lookup runs only for a row that passes the
 * cheap checks. Never throws; any failure is no offer.
 */
export async function firstPurchaseOfferForUser(
  supabase: SupabaseClient<any, any, any>,
  admin: SupabaseClient<any, any, any>,
  user: { id: string; email?: string | null },
  now: Date = new Date()
): Promise<CheckoutOfferId | null> {
  try {
    const { data: row, error } = await supabase.from('user_usage').select('*').eq('user_id', user.id).maybeSingle();
    if (error) throw error;
    const hasUnlimited = hasUnlimitedEdits(user.email);
    if (!firstPurchaseOfferFor(row, now, { hasUnlimited })) return null;

    let stripeCustomer: boolean | 'unknown';
    try {
      stripeCustomer = Boolean(await resolveStripeCustomer(supabase, user));
    } catch (lookupError) {
      console.error('[first-purchase-offer] Stripe customer lookup failed:', lookupError);
      stripeCustomer = 'unknown';
    }
    return await resolveFirstPurchaseOffer(admin, user.id, row, { hasUnlimited, stripeCustomer, now });
  } catch (error) {
    console.error('[first-purchase-offer] eligibility check failed:', error);
    return null;
  }
}
