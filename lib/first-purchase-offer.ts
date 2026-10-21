import {
  CHECKOUT_OFFERS,
  WARM_LEAD_OFFER_ID,
  discountedAmount,
  type CheckoutOfferId,
} from '@/lib/checkout-offers';
import {
  proEntitlement,
  type EntitlementRow,
  type StripeStatusReport,
} from '@/lib/subscription/entitlement';
import { PRO_PLANS } from '@/data/constants';

/**
 * The first-purchase offer: the warm_lead_offer discount (welcome50, 50% off
 * the first Pro month) shown in the paywall and on /buy to a user who has
 * never paid for anything. Pure and browser-safe; the server side (the
 * purchase ledgers) is lib/first-purchase-offer-server.ts.
 *
 * The rule is "no prior purchase of any kind on record" because the
 * WELCOME50 promotion code is restricted to `first_time_transaction`. It is
 * decided from our own tables only, never from Stripe, so the paywall (GET
 * /api/subscription-status, read for nearly every free user on every
 * status fetch) and the /buy server render decide it the same way and /buy
 * adds no Stripe call. The few accounts a Stripe lookup would catch (a
 * returning customer whose row carries no trace of the old purchase) are
 * handled at checkout: Stripe refuses the code with
 * `promotion_code_customer_not_first_time` and app/api/checkout-session
 * opens the session again without it: they pay full price, as they would
 * have without the offer.
 */

export const FIRST_PURCHASE_OFFER_ID: CheckoutOfferId = WARM_LEAD_OFFER_ID;

/**
 * Kill switch. Off when either
 *   - LIFECYCLE_WARM_LEAD_OFFER_ENABLED=false (the switch for the
 *     warm_lead_offer email, lib/lifecycle/config.ts: switching the offer
 *     off there switches it off everywhere), or
 *   - FIRST_PURCHASE_OFFER_ENABLED=false (just the in-app paywall and /buy
 *     auto-offer; the email keeps going).
 * Both default on.
 */
export function firstPurchaseOfferEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.LIFECYCLE_WARM_LEAD_OFFER_ENABLED !== 'false' && env.FIRST_PURCHASE_OFFER_ENABLED !== 'false';
}

/** The user_usage columns the rule reads. */
export interface FirstPurchaseOfferRow extends EntitlementRow {
  stripe_customer_id?: string | null;
  edit_credits?: number | null;
  generation_credits?: number | null;
}

export interface FirstPurchaseOfferContext {
  /** lib/paywall.ts `hasUnlimitedEdits(email)`: staff never see an offer. */
  hasUnlimited?: boolean;
  /** Stripe's effective status for the user's subscription, when the caller already has it. */
  stripeStatus?: StripeStatusReport;
  /**
   * A row in credit_purchases or generation_purchases. The one-off
   * purchases never write stripe_customer_id, and a spent credit leaves the
   * balance at 0, so the ledgers are the only record of them.
   */
  hasPurchaseHistory?: boolean;
  env?: Record<string, string | undefined>;
}

/** Row statuses of an account that has never had a subscription. */
const NEVER_SUBSCRIBED_STATUSES: ReadonlySet<string> = new Set(['inactive']);

/**
 * `welcome50` for an account that has never bought anything, else null.
 *
 * Null for: the kill switch off; no row; allowlisted / `unlimited`; Pro by
 * the entitlement rule; `is_pro` set at all (a flag-only grant, or a stale
 * row: either way not a first purchase); a stored Stripe customer or
 * subscription id; any row status other than `inactive`/null (canceled,
 * past_due, paused, ...: they paid once); a non-zero edit or generation
 * credit balance; a one-off purchase in the ledgers.
 */
export function firstPurchaseOfferFor(
  row: FirstPurchaseOfferRow | null | undefined,
  now: Date = new Date(),
  context: FirstPurchaseOfferContext = {}
): CheckoutOfferId | null {
  const { hasUnlimited = false, stripeStatus, hasPurchaseHistory = false, env } = context;
  if (!firstPurchaseOfferEnabled(env)) return null;
  if (!row) return null;
  if (hasUnlimited || row.subscription_status === 'unlimited') return null;
  if (proEntitlement({ row, stripeStatus, hasUnlimited, now }).isPro) return null;
  if (row.is_pro) return null;
  if (row.stripe_customer_id || row.stripe_subscription_id) return null;
  if (row.subscription_status != null && !NEVER_SUBSCRIBED_STATUSES.has(row.subscription_status)) return null;
  if ((row.edit_credits ?? 0) > 0 || (row.generation_credits ?? 0) > 0) return null;
  if (hasPurchaseHistory) return null;
  return FIRST_PURCHASE_OFFER_ID;
}

/** Copy for the paywall's Pro card under an offer, from PRO_PLANS and the offer. */
export function firstPurchaseOfferCopy(offerId: CheckoutOfferId) {
  const offer = CHECKOUT_OFFERS[offerId];
  const monthly = PRO_PLANS.monthly;
  const firstMonth = `$${discountedAmount(monthly.amount, offer.percentOff).toFixed(2)}`;
  return {
    /** "$4.99 first month, then $9.99/mo" */
    priceLine: `${firstMonth} first month, then ${monthly.price}/mo`,
    /** "50% off your first month, applied at checkout" */
    note: `${offer.label}, applied at checkout`,
    /** "Go Pro — 50% off first month" */
    button: `Go Pro — ${offer.percentOff}% off first month`,
  };
}
