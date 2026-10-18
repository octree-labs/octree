import type Stripe from 'stripe';

import { STRIPE_PRICE_IDS } from '@/lib/stripe-config';

/**
 * The Stripe prices the app sells, keyed by Stripe `lookup_key`. Prices are
 * provisioned by code on first use (`getOrCreatePrice`) instead of being
 * pasted in from the dashboard, so test and live mode get the same catalogue
 * and a fresh Stripe account needs no manual setup.
 *
 * The one exception is the monthly plan: a $9.99/month price already exists
 * (`STRIPE_PRICE_IDS.proAnnual`, historically misnamed) and every live
 * subscriber is on it, so `octree_pro_monthly` resolves to that id and is
 * only created when the configured id is missing.
 *
 * No Stripe client is imported here (`lib/stripe.ts` is `server-only`), so
 * scripts/ensure-stripe-prices.ts can reuse this with its own client.
 */

export const PRICE_LOOKUP_KEYS = {
  monthly: 'octree_pro_monthly',
  annual: 'octree_pro_annual',
  semester: 'octree_semester_pass',
  credits_100: 'octree_credits_100',
} as const;

export type PriceLookupKey = (typeof PRICE_LOOKUP_KEYS)[keyof typeof PRICE_LOOKUP_KEYS];

export const PRICE_METADATA_KEY = 'octree_plan';

interface PriceDefinition {
  productName: string;
  /** Minor units (cents). */
  unitAmount: number;
  currency: 'usd';
  recurring?: Stripe.PriceCreateParams.Recurring;
}

export const PRICE_DEFINITIONS: Record<PriceLookupKey, PriceDefinition> = {
  octree_pro_monthly: {
    productName: 'Octree Pro (Monthly)',
    unitAmount: 999,
    currency: 'usd',
    recurring: { interval: 'month' },
  },
  octree_pro_annual: {
    productName: 'Octree Pro (Annual)',
    unitAmount: 7900,
    currency: 'usd',
    recurring: { interval: 'year' },
  },
  octree_semester_pass: {
    productName: 'Octree Semester Pass',
    unitAmount: 2900,
    currency: 'usd',
    recurring: { interval: 'month', interval_count: 4 },
  },
  octree_credits_100: {
    productName: '100 AI edit credits',
    unitAmount: 500,
    currency: 'usd',
  },
};

export function isPriceLookupKey(value: unknown): value is PriceLookupKey {
  return (
    typeof value === 'string' &&
    (Object.values(PRICE_LOOKUP_KEYS) as string[]).includes(value)
  );
}

/** The subset of the Stripe client `getOrCreatePrice` needs; mockable in tests. */
export type PriceClient = {
  prices: {
    list(params: Stripe.PriceListParams): Promise<Pick<Stripe.ApiList<Stripe.Price>, 'data'>>;
    create(
      params: Stripe.PriceCreateParams,
      options?: Stripe.RequestOptions
    ): Promise<Stripe.Price>;
  };
};

/**
 * Per-instance cache of resolved price ids. A lambda instance resolves each
 * key at most once; the Stripe `lookup_key` (unique among active prices)
 * keeps different instances from creating duplicates.
 */
const cache = new Map<PriceLookupKey, Promise<string>>();

export function resetPriceCacheForTests(): void {
  cache.clear();
}

/**
 * The configured id for a key when the price predates lookup keys. Only the
 * monthly plan has one; it is the live price every subscriber is on.
 */
function preconfiguredPriceId(lookupKey: PriceLookupKey): string | null {
  if (lookupKey === PRICE_LOOKUP_KEYS.monthly) {
    const id = STRIPE_PRICE_IDS.proAnnual;
    return typeof id === 'string' && id.length > 0 ? id : null;
  }
  return null;
}

async function findActivePrice(client: PriceClient, lookupKey: PriceLookupKey) {
  const { data } = await client.prices.list({ lookup_keys: [lookupKey], active: true, limit: 1 });
  return data[0] ?? null;
}

function isAlreadyExistsError(error: unknown): boolean {
  const err = error as { code?: string; type?: string; message?: string } | null;
  if (!err) return false;
  if (err.code === 'resource_already_exists') return true;
  // A concurrent create with the same idempotency key is still in flight.
  if (err.type === 'StripeIdempotencyError' || err.code === 'idempotency_key_in_use') return true;
  return typeof err.message === 'string' && /lookup_key/i.test(err.message) && /exist|in use/i.test(err.message);
}

async function resolvePrice(client: PriceClient, lookupKey: PriceLookupKey): Promise<string> {
  const configured = preconfiguredPriceId(lookupKey);
  if (configured) return configured;

  const existing = await findActivePrice(client, lookupKey);
  if (existing) return existing.id;

  const def = PRICE_DEFINITIONS[lookupKey];
  try {
    const created = await client.prices.create(
      {
        currency: def.currency,
        unit_amount: def.unitAmount,
        ...(def.recurring ? { recurring: def.recurring } : {}),
        lookup_key: lookupKey,
        transfer_lookup_key: true,
        metadata: { [PRICE_METADATA_KEY]: lookupKey },
        product_data: {
          name: def.productName,
          metadata: { [PRICE_METADATA_KEY]: lookupKey },
        },
      },
      // Two cold instances creating the same key at once send the same
      // idempotent request; Stripe returns one price for both (or rejects the
      // second while the first is in flight, which the catch below retries).
      { idempotencyKey: `octree-price-${lookupKey}-v1` }
    );
    return created.id;
  } catch (error) {
    if (!isAlreadyExistsError(error)) throw error;
    const raced = await findActivePrice(client, lookupKey);
    if (raced) return raced.id;
    throw error;
  }
}

/**
 * The Stripe price id for a lookup key, creating product and price on the
 * first miss. Results are cached for the life of the process; a failure is
 * not cached so the next call retries.
 */
export function getOrCreatePrice(lookupKey: PriceLookupKey, client: PriceClient): Promise<string> {
  const cached = cache.get(lookupKey);
  if (cached) return cached;

  const pending = resolvePrice(client, lookupKey).catch((error) => {
    cache.delete(lookupKey);
    throw error;
  });
  cache.set(lookupKey, pending);
  return pending;
}
