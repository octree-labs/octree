import { describe, it, expect, beforeEach, vi } from 'vitest';

import {
  PRICE_LOOKUP_KEYS,
  getOrCreatePrice,
  resetPriceCacheForTests,
  type PriceClient,
} from '@/lib/stripe-prices';
import { STRIPE_PRICE_IDS } from '@/lib/stripe-config';

function makeClient(overrides: Partial<{ list: any; create: any }> = {}) {
  const list = overrides.list ?? vi.fn().mockResolvedValue({ data: [] });
  const create =
    overrides.create ?? vi.fn(async (params: any) => ({ id: `price_${params.lookup_key}`, ...params }));
  const client = { prices: { list, create } } as unknown as PriceClient;
  return { client, list, create };
}

describe('getOrCreatePrice', () => {
  beforeEach(() => {
    resetPriceCacheForTests();
  });

  it('returns the configured monthly price id without touching Stripe', async () => {
    const { client, list, create } = makeClient();

    const id = await getOrCreatePrice(PRICE_LOOKUP_KEYS.monthly, client);

    expect(id).toBe(STRIPE_PRICE_IDS.proAnnual);
    expect(list).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it('never creates the monthly price: with no configured id it reuses a keyed price or throws', async () => {
    vi.resetModules();
    vi.doMock('@/lib/stripe-config', () => ({ STRIPE_PRICE_IDS: { pro: '', proAnnual: '' } }));
    try {
      const mod = await import('@/lib/stripe-prices');

      const keyed = makeClient({ list: vi.fn().mockResolvedValue({ data: [{ id: 'price_monthly_keyed' }] }) });
      await expect(mod.getOrCreatePrice(mod.PRICE_LOOKUP_KEYS.monthly, keyed.client)).resolves.toBe(
        'price_monthly_keyed'
      );
      expect(keyed.create).not.toHaveBeenCalled();

      mod.resetPriceCacheForTests();
      const missing = makeClient();
      await expect(mod.getOrCreatePrice(mod.PRICE_LOOKUP_KEYS.monthly, missing.client)).rejects.toThrow(
        /never created/
      );
      expect(missing.create).not.toHaveBeenCalled();
    } finally {
      vi.doUnmock('@/lib/stripe-config');
      vi.resetModules();
    }
  });

  it('reuses an active price that already carries the lookup key', async () => {
    const { client, list, create } = makeClient({
      list: vi.fn().mockResolvedValue({ data: [{ id: 'price_existing' }] }),
    });

    const id = await getOrCreatePrice(PRICE_LOOKUP_KEYS.annual, client);

    expect(id).toBe('price_existing');
    expect(list).toHaveBeenCalledWith({ lookup_keys: ['octree_pro_annual'], active: true, limit: 1 });
    expect(create).not.toHaveBeenCalled();
  });

  it('creates product and price with the lookup key, metadata and an idempotency key on a miss', async () => {
    const { client, create } = makeClient();

    const id = await getOrCreatePrice(PRICE_LOOKUP_KEYS.semester, client);

    expect(id).toBe('price_octree_semester_pass');
    expect(create).toHaveBeenCalledTimes(1);
    const [params, options] = create.mock.calls[0];
    expect(params).toMatchObject({
      currency: 'usd',
      unit_amount: 2900,
      recurring: { interval: 'month', interval_count: 4 },
      lookup_key: 'octree_semester_pass',
      transfer_lookup_key: true,
      metadata: { octree_plan: 'octree_semester_pass' },
      product_data: { name: 'Octree Semester Pass', metadata: { octree_plan: 'octree_semester_pass' } },
    });
    expect(options).toEqual({ idempotencyKey: 'octree-price-octree_semester_pass-v1' });
  });

  it('creates the credit pack as a one-time $5 price', async () => {
    const { client, create } = makeClient();

    await getOrCreatePrice(PRICE_LOOKUP_KEYS.credits_100, client);

    const [params] = create.mock.calls[0];
    expect(params.unit_amount).toBe(500);
    expect(params).not.toHaveProperty('recurring');
  });

  it('creates the annual plan at $79 per year', async () => {
    const { client, create } = makeClient();

    await getOrCreatePrice(PRICE_LOOKUP_KEYS.annual, client);

    const [params] = create.mock.calls[0];
    expect(params).toMatchObject({ unit_amount: 7900, recurring: { interval: 'year' } });
  });

  it('caches the resolved id per process so a second call makes no Stripe request', async () => {
    const { client, list, create } = makeClient();

    const first = await getOrCreatePrice(PRICE_LOOKUP_KEYS.annual, client);
    const second = await getOrCreatePrice(PRICE_LOOKUP_KEYS.annual, client);

    expect(second).toBe(first);
    expect(list).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('dedupes concurrent callers in one process to a single create', async () => {
    const { client, create } = makeClient();

    const ids = await Promise.all([
      getOrCreatePrice(PRICE_LOOKUP_KEYS.annual, client),
      getOrCreatePrice(PRICE_LOOKUP_KEYS.annual, client),
      getOrCreatePrice(PRICE_LOOKUP_KEYS.annual, client),
    ]);

    expect(new Set(ids).size).toBe(1);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('falls back to a second lookup when another instance created the price first (race)', async () => {
    const list = vi
      .fn()
      .mockResolvedValueOnce({ data: [] })
      .mockResolvedValueOnce({ data: [{ id: 'price_from_other_instance' }] });
    const create = vi.fn().mockRejectedValue(
      Object.assign(new Error('A price with lookup_key already exists'), {
        code: 'resource_already_exists',
      })
    );
    const { client } = makeClient({ list, create });

    const id = await getOrCreatePrice(PRICE_LOOKUP_KEYS.annual, client);

    expect(id).toBe('price_from_other_instance');
    expect(list).toHaveBeenCalledTimes(2);
  });

  it('retries after an in-flight idempotent create from another instance', async () => {
    const list = vi
      .fn()
      .mockResolvedValueOnce({ data: [] })
      .mockResolvedValueOnce({ data: [{ id: 'price_after_retry' }] });
    const create = vi.fn().mockRejectedValue(
      Object.assign(new Error('Keys for idempotent requests...'), { type: 'StripeIdempotencyError' })
    );
    const { client } = makeClient({ list, create });

    await expect(getOrCreatePrice(PRICE_LOOKUP_KEYS.credits_100, client)).resolves.toBe('price_after_retry');
  });

  it('rethrows other Stripe errors and does not cache the failure', async () => {
    const create = vi
      .fn()
      .mockRejectedValueOnce(Object.assign(new Error('rate limited'), { code: 'rate_limit' }))
      .mockResolvedValueOnce({ id: 'price_second_try' });
    const { client } = makeClient({ create });

    await expect(getOrCreatePrice(PRICE_LOOKUP_KEYS.annual, client)).rejects.toThrow('rate limited');
    await expect(getOrCreatePrice(PRICE_LOOKUP_KEYS.annual, client)).resolves.toBe('price_second_try');
  });

  it('creates the $2.99 one-off generation price (no recurring) on a miss', async () => {
    const { client, create } = makeClient();

    const id = await getOrCreatePrice(PRICE_LOOKUP_KEYS.generate_single, client);

    expect(id).toBe('price_octree_generate_single');
    const [params] = create.mock.calls[0];
    expect(params).toMatchObject({
      currency: 'usd',
      unit_amount: 299,
      lookup_key: 'octree_generate_single',
      product_data: { name: 'One AI document generation' },
    });
    expect(params).not.toHaveProperty('recurring');
  });
});
