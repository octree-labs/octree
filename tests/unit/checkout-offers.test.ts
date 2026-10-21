import { describe, it, expect, vi, beforeEach } from 'vitest';

import {
  CHECKOUT_OFFERS,
  discountedAmount,
  isCheckoutOfferId,
  offerAppliesToPlan,
  warmLeadOfferUrl,
} from '@/lib/checkout-offers';
import { ensureOfferPromotionCode, resetOfferPromotionCodesForTests } from '@/lib/checkout-offers-stripe';

describe('checkout offer constants', () => {
  it('knows welcome50, for the monthly plan only', () => {
    expect(isCheckoutOfferId('welcome50')).toBe(true);
    expect(isCheckoutOfferId('WELCOME50')).toBe(false);
    expect(CHECKOUT_OFFERS.welcome50).toMatchObject({ coupon: 'first-month-50', promotionCode: 'WELCOME50', percentOff: 50 });
    expect(offerAppliesToPlan('welcome50', 'monthly')).toBe(true);
    expect(offerAppliesToPlan('welcome50', 'annual')).toBe(false);
    expect(offerAppliesToPlan('welcome50', 'semester')).toBe(false);
    expect(offerAppliesToPlan('welcome50', 'credits_100')).toBe(false);
    expect(offerAppliesToPlan('welcome50', 'generate_single')).toBe(false);
  });

  it('prices the first payment like Stripe', () => {
    expect(discountedAmount(9.99, 50)).toBe(4.99);
    expect(discountedAmount(79, 50)).toBe(39.5);
    expect(discountedAmount(29, 50)).toBe(14.5);
  });

  it('builds the email link', () => {
    expect(warmLeadOfferUrl('https://app.example.com')).toBe(
      'https://app.example.com/buy?offer=welcome50&utm_source=lifecycle&utm_campaign=warm_lead_offer'
    );
  });
});

describe('ensureOfferPromotionCode', () => {
  beforeEach(() => resetOfferPromotionCodesForTests());

  const stripeError = (code: string) => Object.assign(new Error(code), { code });
  const promo = (over: Record<string, unknown> = {}) => ({ id: 'promo_1', code: 'WELCOME50', active: true, coupon: { id: 'first-month-50' }, ...over });

  function fakeStripe() {
    return {
      coupons: { retrieve: vi.fn(), create: vi.fn() },
      promotionCodes: { list: vi.fn(), create: vi.fn() },
    };
  }

  it('uses an existing active code on the coupon and caches it', async () => {
    const stripe = fakeStripe();
    stripe.promotionCodes.list.mockResolvedValue({ data: [promo()] });
    await expect(ensureOfferPromotionCode('welcome50', stripe as any)).resolves.toBe('promo_1');
    await expect(ensureOfferPromotionCode('welcome50', stripe as any)).resolves.toBe('promo_1');
    expect(stripe.promotionCodes.list).toHaveBeenCalledTimes(1);
    expect(stripe.promotionCodes.list).toHaveBeenCalledWith(expect.objectContaining({ code: 'WELCOME50', active: true }));
    expect(stripe.coupons.create).not.toHaveBeenCalled();
  });

  it('creates the coupon and the first-time-only code when neither exists', async () => {
    const stripe = fakeStripe();
    stripe.promotionCodes.list.mockResolvedValue({ data: [] });
    stripe.coupons.retrieve.mockRejectedValue(stripeError('resource_missing'));
    stripe.coupons.create.mockResolvedValue({ id: 'first-month-50' });
    stripe.promotionCodes.create.mockResolvedValue(promo({ id: 'promo_new' }));
    await expect(ensureOfferPromotionCode('welcome50', stripe as any)).resolves.toBe('promo_new');
    expect(stripe.coupons.create).toHaveBeenCalledWith({
      id: 'first-month-50',
      name: '50% off your first month',
      percent_off: 50,
      duration: 'once',
    });
    expect(stripe.promotionCodes.create).toHaveBeenCalledWith({
      coupon: 'first-month-50',
      code: 'WELCOME50',
      restrictions: { first_time_transaction: true },
    });
  });

  it('survives a race on the coupon and on the code', async () => {
    const stripe = fakeStripe();
    stripe.promotionCodes.list.mockResolvedValueOnce({ data: [] }).mockResolvedValueOnce({ data: [promo({ id: 'promo_raced' })] });
    stripe.coupons.retrieve.mockRejectedValue(stripeError('resource_missing'));
    stripe.coupons.create.mockRejectedValue(stripeError('resource_already_exists'));
    stripe.promotionCodes.create.mockRejectedValue(stripeError('resource_already_exists'));
    await expect(ensureOfferPromotionCode('welcome50', stripe as any)).resolves.toBe('promo_raced');
  });

  it('refuses a code that lives on another coupon, and does not cache the failure', async () => {
    const stripe = fakeStripe();
    stripe.promotionCodes.list.mockResolvedValue({ data: [promo({ coupon: { id: 'other' } })] });
    stripe.coupons.retrieve.mockResolvedValue({ id: 'first-month-50' });
    stripe.promotionCodes.create.mockRejectedValue(stripeError('resource_already_exists'));
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(ensureOfferPromotionCode('welcome50', stripe as any)).resolves.toBeNull();
    stripe.promotionCodes.list.mockResolvedValue({ data: [promo()] });
    await expect(ensureOfferPromotionCode('welcome50', stripe as any)).resolves.toBe('promo_1');
    error.mockRestore();
  });

  it('returns null instead of throwing when Stripe is down', async () => {
    const stripe = fakeStripe();
    stripe.promotionCodes.list.mockRejectedValue(new Error('network'));
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(ensureOfferPromotionCode('welcome50', stripe as any)).resolves.toBeNull();
    error.mockRestore();
  });
});
