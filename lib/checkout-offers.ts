/**
 * Discount offers a checkout link can carry (`/buy?offer=<id>`, then
 * `{ offer }` in the /api/checkout-session body). The server applies only
 * offers listed here; the browser may only name one. Pure constants with no
 * Stripe import, so the buy page can use them; the Stripe side (creating the
 * coupon and promotion code) is lib/checkout-offers-stripe.ts.
 */

export const CHECKOUT_OFFER_IDS = ['welcome50'] as const;
export type CheckoutOfferId = (typeof CHECKOUT_OFFER_IDS)[number];

/** The recurring plans; the one-off purchases (credits_100, generate_single) never take an offer. */
export type OfferPlan = 'monthly' | 'annual' | 'semester';

export interface CheckoutOffer {
  /** Stripe coupon id; created on first use with the fields below. */
  coupon: string;
  /** Customer-facing Stripe promotion code on that coupon. */
  promotionCode: string;
  percentOff: number;
  /** Coupon name and banner copy. */
  label: string;
  /** Plans the offer applies to; any other plan checks out without it. */
  plans: readonly OfferPlan[];
}

export const CHECKOUT_OFFERS: Record<CheckoutOfferId, CheckoutOffer> = {
  welcome50: {
    coupon: 'first-month-50',
    promotionCode: 'WELCOME50',
    percentOff: 50,
    label: '50% off your first month',
    plans: ['monthly', 'annual', 'semester'],
  },
};

/** The offer in the warm_lead_offer email (lib/email/lifecycle). */
export const WARM_LEAD_OFFER_ID: CheckoutOfferId = 'welcome50';
export const WARM_LEAD_OFFER = CHECKOUT_OFFERS[WARM_LEAD_OFFER_ID];

export function isCheckoutOfferId(value: unknown): value is CheckoutOfferId {
  return typeof value === 'string' && (CHECKOUT_OFFER_IDS as readonly string[]).includes(value);
}

export function offerAppliesToPlan(offerId: CheckoutOfferId, plan: string): plan is OfferPlan {
  return (CHECKOUT_OFFERS[offerId].plans as readonly string[]).includes(plan);
}

/** The warm_lead_offer email's link: /buy with the offer pre-applied. */
export function warmLeadOfferUrl(appUrl: string): string {
  return `${appUrl}/buy?offer=${WARM_LEAD_OFFER_ID}&utm_source=lifecycle&utm_campaign=warm_lead_offer`;
}

/**
 * The first payment under a percent-off offer, in major units: $4.99 for 50%
 * off $9.99. Worked in cents with the discount rounded to the nearest cent,
 * as Stripe does.
 */
export function discountedAmount(amount: number, percentOff: number): number {
  const cents = Math.round(amount * 100);
  return (cents - Math.round((cents * percentOff) / 100)) / 100;
}
