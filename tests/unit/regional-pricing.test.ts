import { describe, it, expect, beforeEach, vi } from 'vitest';

import {
  REGIONAL_AMOUNT_CENTS,
  baseLookupKey,
  countryFromHeaders,
  formatUsd,
  priceTierForCountry,
  regionalLookupKey,
  type RegionalPlan,
} from '@/lib/regional-pricing';
import { pricingCatalog } from '@/lib/pricing-catalog';
import {
  PRICE_DEFINITIONS,
  PRICE_LOOKUP_KEYS,
  getOrCreatePrice,
  resetPriceCacheForTests,
  type PriceClient,
} from '@/lib/stripe-prices';
import { planFromPrice } from '@/lib/stripe-webhook';
import { STRIPE_PRICE_IDS } from '@/lib/stripe-config';
import { buildCheckoutSessionParams } from '@/lib/checkout-plans';
import { firstPurchaseOfferCopy } from '@/lib/first-purchase-offer';
import {
  CREDIT_PACKS,
  EXPORT_SINGLE_PRICE,
  GENERATE_SINGLE_PRICE,
  PRO_PLANS,
} from '@/data/constants';
import { limitReachedMessage } from '@/lib/usage/allowance';

describe('priceTierForCountry', () => {
  it('maps the top sign-up countries to a regional tier', () => {
    for (const c of ['IN', 'VN', 'TN', 'DZ', 'ID', 'EG', 'PK']) expect(priceTierForCountry(c)).toBe('tier3');
    for (const c of ['BR', 'PE', 'MX', 'CO', 'CN', 'TR', 'ZA']) expect(priceTierForCountry(c)).toBe('tier2');
  });

  it('keeps the list price for everyone else and for unknown input', () => {
    for (const c of ['US', 'GB', 'DE', 'IT', 'HK', 'SG', 'JP', 'XX', '', null, undefined]) {
      expect(priceTierForCountry(c)).toBe('standard');
    }
  });

  it('is case and whitespace insensitive', () => {
    expect(priceTierForCountry(' in ')).toBe('tier3');
  });
});

describe('regional amounts', () => {
  const PLAN_KEYS = Object.entries(PRICE_LOOKUP_KEYS) as [RegionalPlan, keyof typeof PRICE_DEFINITIONS][];

  it('has a regional row for every plan Stripe sells', () => {
    expect(Object.keys(REGIONAL_AMOUNT_CENTS).sort()).toEqual(Object.keys(PRICE_LOOKUP_KEYS).sort());
  });

  it('display list prices equal the Stripe list prices', () => {
    const list = pricingCatalog('standard');
    const shown: Record<RegionalPlan, number> = {
      monthly: list.proPlans.monthly.amount,
      annual: list.proPlans.annual.amount,
      semester: list.proPlans.semester.amount,
      credits_100: list.creditPack.amount,
      generate_single: list.generateSingle.amount,
      export_single: list.exportSingle.amount,
    };
    for (const [plan, key] of PLAN_KEYS) {
      expect(Math.round(shown[plan] * 100)).toBe(PRICE_DEFINITIONS[key].unitAmount);
    }
  });

  it('only ever lowers a price, and tier3 is the lowest', () => {
    for (const [plan, key] of PLAN_KEYS) {
      const amounts = REGIONAL_AMOUNT_CENTS[plan];
      expect(amounts.tier2).toBeLessThan(PRICE_DEFINITIONS[key].unitAmount);
      expect(amounts.tier3).toBeLessThan(amounts.tier2);
      // Stripe's minimum charge is $0.50.
      expect(amounts.tier3).toBeGreaterThanOrEqual(50);
    }
  });
});

describe('lookup keys and formatting', () => {
  it('suffixes regional lookup keys and strips them back', () => {
    expect(regionalLookupKey('octree_pro_monthly', 'standard')).toBe('octree_pro_monthly');
    expect(regionalLookupKey('octree_pro_monthly', 'tier3')).toBe('octree_pro_monthly__tier3');
    expect(baseLookupKey('octree_pro_monthly__tier3')).toBe('octree_pro_monthly');
    expect(baseLookupKey('octree_pro_annual__tier2')).toBe('octree_pro_annual');
    expect(baseLookupKey('octree_pro_annual')).toBe('octree_pro_annual');
  });

  it('formats US dollars', () => {
    expect(formatUsd(999)).toBe('$9.99');
    expect(formatUsd(7900)).toBe('$79');
    expect(formatUsd(99)).toBe('$0.99');
    expect(formatUsd(300)).toBe('$3');
  });
});

describe('countryFromHeaders', () => {
  const h = (country?: string) => new Headers(country ? { 'x-vercel-ip-country': country } : {});

  it('reads the Vercel country header', () => {
    expect(countryFromHeaders(h('in'), { VERCEL_ENV: 'production' })).toBe('IN');
    expect(countryFromHeaders(h(), { VERCEL_ENV: 'production' })).toBeNull();
    expect(countryFromHeaders(h('not-a-country'), { VERCEL_ENV: 'production' })).toBeNull();
  });

  it('honours PRICING_COUNTRY_OVERRIDE outside production only', () => {
    expect(countryFromHeaders(h('US'), { VERCEL_ENV: 'preview', PRICING_COUNTRY_OVERRIDE: 'BR' })).toBe('BR');
    expect(countryFromHeaders(h(), { PRICING_COUNTRY_OVERRIDE: 'IN' })).toBe('IN');
    expect(countryFromHeaders(h('US'), { VERCEL_ENV: 'production', PRICING_COUNTRY_OVERRIDE: 'IN' })).toBe('US');
  });
});

describe('pricingCatalog', () => {
  it('returns the constants unchanged at the list price', () => {
    const c = pricingCatalog('standard');
    expect(c.proPlans.monthly.price).toBe(PRO_PLANS.monthly.price);
    expect(c.proPlans.annual.billingNote).toBe(PRO_PLANS.annual.billingNote);
    expect(c.proPlans.semester.price).toBe(PRO_PLANS.semester.price);
    expect(c.creditPack.label).toBe(CREDIT_PACKS.credits_100.label);
    expect(c.exportSingle.price).toBe(EXPORT_SINGLE_PRICE.price);
    expect(c.generateSingle.price).toBe(GENERATE_SINGLE_PRICE.price);
  });

  it('shows the regional amounts in every string that has a price', () => {
    const c = pricingCatalog('tier3');
    expect(c.proPlans.monthly).toMatchObject({ amount: 3.99, price: '$3.99' });
    expect(c.proPlans.annual).toMatchObject({ amount: 31, price: '$31' });
    expect(c.proPlans.annual.billingNote).toBe('Just $2.58 a month, billed yearly. Cancel anytime.');
    expect(c.creditPack.label).toBe('100 AI edits for $2');
    expect(c.exportSingle.price).toBe('$1.99');
    expect(c.generateSingle.price).toBe('$0.99');
  });

  it('feeds the first-purchase offer copy', () => {
    const copy = firstPurchaseOfferCopy('welcome50', pricingCatalog('tier2').proPlans.monthly);
    expect(copy.priceLine).toBe('$2.99 first month, then $5.99/mo');
    expect(firstPurchaseOfferCopy('welcome50').priceLine).toBe('$4.99 first month, then $9.99/mo');
  });
});

describe('getOrCreatePrice with a regional tier', () => {
  beforeEach(() => resetPriceCacheForTests());

  function makeClient(existing: { id: string; unit_amount?: number }[] = []) {
    const list = vi.fn().mockResolvedValue({ data: existing });
    const create = vi.fn(async (params: any, _options?: any) => ({ id: `price_${params.lookup_key}`, ...params }));
    const retrieve = vi.fn(async (id: string) => ({ id, product: `prod_of_${id}` }));
    return { client: { prices: { list, create, retrieve } } as unknown as PriceClient, list, create, retrieve };
  }

  it("creates the regional monthly price on the list price's product, with its own key and amount", async () => {
    const { client, list, create, retrieve } = makeClient();

    const id = await getOrCreatePrice(PRICE_LOOKUP_KEYS.monthly, client, 'tier3');

    expect(id).toBe('price_octree_pro_monthly__tier3');
    expect(list).toHaveBeenCalledWith({ lookup_keys: ['octree_pro_monthly__tier3'], active: true, limit: 1 });
    expect(retrieve).toHaveBeenCalledWith(STRIPE_PRICE_IDS.proAnnual);
    const [params, options] = create.mock.calls[0];
    expect(params).toMatchObject({
      currency: 'usd',
      unit_amount: 399,
      recurring: { interval: 'month' },
      lookup_key: 'octree_pro_monthly__tier3',
      transfer_lookup_key: true,
      product: `prod_of_${STRIPE_PRICE_IDS.proAnnual}`,
      metadata: { octree_plan: 'octree_pro_monthly', octree_price_tier: 'tier3' },
    });
    expect(params).not.toHaveProperty('product_data');
    expect(options).toEqual({ idempotencyKey: 'octree-price-octree_pro_monthly__tier3-399-v1' });
  });

  it('reuses an existing regional price at the right amount and caches per tier', async () => {
    const { client, create, list } = makeClient([{ id: 'price_regional', unit_amount: 299 }]);

    await expect(getOrCreatePrice(PRICE_LOOKUP_KEYS.export_single, client, 'tier2')).resolves.toBe('price_regional');
    await getOrCreatePrice(PRICE_LOOKUP_KEYS.export_single, client, 'tier2');

    expect(create).not.toHaveBeenCalled();
    expect(list).toHaveBeenCalledTimes(1);
  });

  it('replaces a regional price whose amount no longer matches the table', async () => {
    const { client, create } = makeClient([{ id: 'price_old', unit_amount: 249 }]);

    const id = await getOrCreatePrice(PRICE_LOOKUP_KEYS.export_single, client, 'tier2');

    expect(id).toBe('price_octree_export_single__tier2');
    expect(create.mock.calls.at(-1)?.[0]).toMatchObject({
      lookup_key: 'octree_export_single__tier2',
      unit_amount: 299,
      transfer_lookup_key: true,
    });
  });

  it('leaves the list price path untouched', async () => {
    const { client, create } = makeClient();
    await getOrCreatePrice(PRICE_LOOKUP_KEYS.export_single, client);
    expect(create.mock.calls[0][0]).toMatchObject({
      lookup_key: 'octree_export_single',
      unit_amount: 499,
      product_data: { name: 'Octree — Export this document' },
    });
  });
});

describe('webhook plan mapping', () => {
  it('maps a regional price to the same plan as its list price', () => {
    expect(planFromPrice({ id: 'price_x', lookup_key: 'octree_pro_monthly__tier3' })).toBe('monthly');
    expect(planFromPrice({ id: 'price_y', lookup_key: 'octree_pro_annual__tier2' })).toBe('annual');
    expect(planFromPrice({ id: 'price_z', lookup_key: null, metadata: { octree_plan: 'octree_semester_pass' } })).toBe(
      'semester'
    );
  });
});

describe('checkout metadata', () => {
  const base = {
    priceId: 'price_1',
    userId: 'user_1',
    customerId: null,
    email: 'a@example.com',
    origin: 'https://app.example.com',
    withTrial: false,
    nowSeconds: 1_700_000_000,
  };

  it('records the tier and country on a regional subscription', () => {
    const params = buildCheckoutSessionParams({ ...base, plan: 'monthly', priceTier: 'tier3', country: 'IN' });
    expect(params.metadata).toMatchObject({ price_tier: 'tier3', country: 'IN' });
    expect(params.subscription_data?.metadata).toMatchObject({ price_tier: 'tier3', country: 'IN' });
  });

  it('adds nothing at the list price', () => {
    const params = buildCheckoutSessionParams({ ...base, plan: 'monthly', priceTier: 'standard', country: 'US' });
    expect(params.metadata).not.toHaveProperty('price_tier');
    expect(params.metadata).not.toHaveProperty('country');
  });
});

describe('limit messages', () => {
  it('name the credit pack without a price, which depends on the region', () => {
    for (const isPro of [true, false]) {
      expect(limitReachedMessage(isPro)).toContain('100 edits');
      expect(limitReachedMessage(isPro)).not.toMatch(/\$/);
    }
  });
});
