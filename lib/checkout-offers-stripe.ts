import type Stripe from 'stripe';

import { CHECKOUT_OFFERS, type CheckoutOfferId } from '@/lib/checkout-offers';

/**
 * The Stripe side of lib/checkout-offers.ts: makes sure an offer's coupon
 * and promotion code exist, and returns the promotion code id Checkout's
 * `discounts` takes. Same idempotent, race-safe steps as the save coupon
 * (lib/subscription-save.ts) and COMEBACK50 (lib/lifecycle/billing-send.ts):
 * retrieve, else create, and on `resource_already_exists` use what the other
 * request created. Takes the Stripe client as an argument (lib/stripe.ts is
 * server-only and tests pass a fake).
 */

export type OfferStripe = {
  coupons: Pick<Stripe.CouponsResource, 'retrieve' | 'create'>;
  promotionCodes: Pick<Stripe.PromotionCodesResource, 'list' | 'create'>;
};

function stripeErrorCode(error: unknown): string | undefined {
  return (error as { code?: string } | null)?.code;
}

function couponIdOf(promo: Stripe.PromotionCode): string {
  return typeof promo.coupon === 'string' ? promo.coupon : promo.coupon.id;
}

async function ensureOfferCoupon(offerId: CheckoutOfferId, stripe: OfferStripe): Promise<void> {
  const offer = CHECKOUT_OFFERS[offerId];
  try {
    await stripe.coupons.retrieve(offer.coupon);
    return;
  } catch (error) {
    if (stripeErrorCode(error) !== 'resource_missing') throw error;
  }
  try {
    await stripe.coupons.create({
      id: offer.coupon,
      name: offer.label,
      percent_off: offer.percentOff,
      duration: 'once',
    });
  } catch (error) {
    // Two requests raced past the retrieve; the other one won.
    if (stripeErrorCode(error) !== 'resource_already_exists') throw error;
  }
}

async function findActivePromotionCode(offerId: CheckoutOfferId, stripe: OfferStripe): Promise<string | null> {
  const offer = CHECKOUT_OFFERS[offerId];
  const byCode = await stripe.promotionCodes.list({ code: offer.promotionCode, active: true, limit: 10 });
  const found = byCode.data.find((promo) => promo.active && couponIdOf(promo) === offer.coupon);
  return found?.id ?? null;
}

async function resolveOfferPromotionCode(offerId: CheckoutOfferId, stripe: OfferStripe): Promise<string | null> {
  const offer = CHECKOUT_OFFERS[offerId];
  const existing = await findActivePromotionCode(offerId, stripe);
  if (existing) return existing;

  await ensureOfferCoupon(offerId, stripe);
  try {
    const created = await stripe.promotionCodes.create({
      coupon: offer.coupon,
      code: offer.promotionCode,
      restrictions: { first_time_transaction: true },
    });
    return created.id;
  } catch (error) {
    // The code exists already (created concurrently, or inactive / on
    // another coupon): use it only if it is live on the offer's coupon.
    const raced = await findActivePromotionCode(offerId, stripe);
    if (raced) return raced;
    console.error(`[checkout-offers] could not create promotion code ${offer.promotionCode}:`, error);
    return null;
  }
}

const cache = new Map<CheckoutOfferId, Promise<string | null>>();

/** Test hook: forget the cached promotion code ids. */
export function resetOfferPromotionCodesForTests(): void {
  cache.clear();
}

/**
 * The Stripe promotion code id (`promo_...`) of the offer, created once if
 * needed. Cached per process. Null when Stripe refuses or fails: the caller
 * then opens a checkout without the discount, never no checkout. A failure
 * is not cached, so the next request tries again.
 */
export function ensureOfferPromotionCode(offerId: CheckoutOfferId, stripe: OfferStripe): Promise<string | null> {
  let pending = cache.get(offerId);
  if (!pending) {
    pending = resolveOfferPromotionCode(offerId, stripe)
      .then((id) => {
        if (!id) cache.delete(offerId);
        return id;
      })
      .catch((error) => {
        console.error(`[checkout-offers] promotion code lookup for ${offerId} failed:`, error);
        cache.delete(offerId);
        return null;
      });
    cache.set(offerId, pending);
  }
  return pending;
}
