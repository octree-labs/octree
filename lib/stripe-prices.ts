import type Stripe from 'stripe';

import { STRIPE_PRICE_IDS } from '@/lib/stripe-config';
import {
  regionalAmountCents,
  regionalLookupKey,
  type PriceTier,
  type RegionalTier,
  type RegionalPlan,
} from '@/lib/regional-pricing';

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
  generate_single: 'octree_generate_single',
  export_single: 'octree_export_single',
} as const;

export type PriceLookupKey = (typeof PRICE_LOOKUP_KEYS)[keyof typeof PRICE_LOOKUP_KEYS];

export const PRICE_METADATA_KEY = 'octree_plan';
/** `metadata.octree_price_tier` on a regional price (lib/regional-pricing.ts). */
export const PRICE_TIER_METADATA_KEY = 'octree_price_tier';

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
  octree_generate_single: {
    productName: 'One AI document generation',
    unitAmount: 299,
    currency: 'usd',
  },
  octree_export_single: {
    productName: 'Octree — Export this document',
    unitAmount: 499,
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
    retrieve(id: string): Promise<Pick<Stripe.Price, 'id' | 'product'>>;
  };
};

/**
 * Per-instance cache of resolved price ids. A lambda instance resolves each
 * key at most once; the Stripe `lookup_key` (unique among active prices)
 * keeps different instances from creating duplicates.
 */
const cache = new Map<string, Promise<string>>();

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

async function findActivePrice(client: PriceClient, lookupKey: string) {
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

  // Every live subscriber is on the pre-existing monthly price; a second
  // $9.99/month price would split them. Creation is only ever for the plans
  // introduced with lookup keys.
  if (lookupKey === PRICE_LOOKUP_KEYS.monthly) {
    throw new Error(
      `No Stripe price configured for ${lookupKey}: set STRIPE_PRICE_IDS.proAnnual in lib/stripe-config.ts ` +
        'or give the existing monthly price this lookup_key in the dashboard. It is never created here.'
    );
  }

  const def = PRICE_DEFINITIONS[lookupKey];
  const metadata = { [PRICE_METADATA_KEY]: lookupKey };
  return createKeyedPrice(client, {
    key: lookupKey,
    unitAmount: def.unitAmount,
    def,
    metadata,
    product: { product_data: { name: def.productName, metadata } },
    idempotencyKey: `octree-price-${lookupKey}-v1`,
  });
}

/**
 * Creates a price under `key` (taking the key over from any older price,
 * `transfer_lookup_key`). Two cold instances creating the same key at once
 * send the same idempotent request; Stripe returns one price for both, or
 * rejects the second while the first is in flight, in which case the price
 * the first one made is read back.
 */
async function createKeyedPrice(
  client: PriceClient,
  input: {
    key: string;
    unitAmount: number;
    def: PriceDefinition;
    metadata: Record<string, string>;
    product: { product: string } | { product_data: Stripe.PriceCreateParams.ProductData };
    idempotencyKey: string;
    /** Regional prices: a raced price only counts if it is at `unitAmount`. */
    requireAmount?: boolean;
  }
): Promise<string> {
  const { key, unitAmount, def, metadata, product, idempotencyKey, requireAmount = false } = input;
  try {
    const created = await client.prices.create(
      {
        currency: def.currency,
        unit_amount: unitAmount,
        ...(def.recurring ? { recurring: def.recurring } : {}),
        lookup_key: key,
        transfer_lookup_key: true,
        metadata,
        ...product,
      },
      { idempotencyKey }
    );
    return created.id;
  } catch (error) {
    if (!isAlreadyExistsError(error)) throw error;
    const raced = await findActivePrice(client, key);
    if (raced && (!requireAmount || raced.unit_amount === unitAmount)) return raced.id;
    throw error;
  }
}

/** The plan behind each list-price key; a key added without a row fails to type-check. */
const PLAN_BY_PRICE_LOOKUP_KEY: Record<PriceLookupKey, RegionalPlan> = {
  octree_pro_monthly: 'monthly',
  octree_pro_annual: 'annual',
  octree_semester_pass: 'semester',
  octree_credits_100: 'credits_100',
  octree_generate_single: 'generate_single',
  octree_export_single: 'export_single',
};

/**
 * A regional price (lib/regional-pricing.ts): its own `lookup_key`
 * (`octree_pro_monthly__tier3`, ...), the tier's amount, and
 * `metadata.octree_plan` set to the list price's key so the webhook maps it
 * to the same plan. It is created on the list price's product, so the tax
 * code, portal settings and product reports carry over.
 *
 * An existing price under the key is reused only while its amount matches
 * REGIONAL_AMOUNT_CENTS. When the table changes, a new price is created at
 * the new amount and takes the key over, so the amount shown in the app
 * (from the same table) is always the amount Stripe charges. Subscribers on
 * the old price keep it.
 */
async function resolveRegionalPrice(
  client: PriceClient,
  lookupKey: PriceLookupKey,
  tier: RegionalTier
): Promise<string> {
  const key = regionalLookupKey(lookupKey, tier);
  const unitAmount = regionalAmountCents(PLAN_BY_PRICE_LOOKUP_KEY[lookupKey], tier);
  const existing = await findActivePrice(client, key);
  if (existing && existing.unit_amount === unitAmount) return existing.id;

  const listPrice = await client.prices.retrieve(await getOrCreatePrice(lookupKey, client));
  const productId = typeof listPrice.product === 'string' ? listPrice.product : listPrice.product.id;
  return createKeyedPrice(client, {
    key,
    unitAmount,
    def: PRICE_DEFINITIONS[lookupKey],
    metadata: { [PRICE_METADATA_KEY]: lookupKey, [PRICE_TIER_METADATA_KEY]: tier },
    product: { product: productId },
    idempotencyKey: `octree-price-${key}-${unitAmount}-v1`,
    requireAmount: true,
  });
}

/**
 * The Stripe price id for a lookup key at a price tier (list price by
 * default), creating product and price on the first miss. Results are
 * cached for the life of the process; a failure is not cached so the next
 * call retries.
 */
export function getOrCreatePrice(
  lookupKey: PriceLookupKey,
  client: PriceClient,
  tier: PriceTier = 'standard'
): Promise<string> {
  const cacheKey = regionalLookupKey(lookupKey, tier);
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const pending = (
    tier === 'standard' ? resolvePrice(client, lookupKey) : resolveRegionalPrice(client, lookupKey, tier)
  ).catch((error) => {
    cache.delete(cacheKey);
    throw error;
  });
  cache.set(cacheKey, pending);
  return pending;
}
