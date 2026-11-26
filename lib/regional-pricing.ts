/**
 * Regional (purchasing-power) pricing.
 *
 * Most sign-ups come from India, Brazil, Vietnam, North Africa, Latin
 * America and Southeast Asia, where $9.99/month in US dollars is a large
 * share of a student's budget; in the 28 days to 2026-11-15, 16 checkouts
 * were opened and 2 were paid. Visitors from those countries see, and are
 * charged, a lower USD price.
 *
 * Three price tiers, chosen from the visitor's country (Vercel's
 * `x-vercel-ip-country` request header, read on the server):
 * - `standard`: the list price, everywhere not listed below.
 * - `tier2`: about 40% off (upper-middle-income markets).
 * - `tier3`: about 60% off (lower-middle-income markets).
 *
 * Pure and isomorphic: the checkout route uses it to pick the Stripe price
 * (lib/stripe-prices.ts creates one Stripe price per plan and tier, keyed by
 * `regionalLookupKey`), GET /api/pricing returns the tier to the browser,
 * and `pricingCatalog(tier)` turns it into the display copy the paywall and
 * plan picker render.
 *
 * A request without a country gets the list price. The country is the IP's,
 * so a visitor on a VPN exit in a listed country does get the lower price;
 * `metadata.price_tier` / `country` on every regional payment make that
 * measurable (and blockable with a Stripe Radar rule on card country).
 * Vercel overwrites `x-vercel-ip-country`, so it cannot be set by the client.
 */

export const PRICE_TIERS = ['standard', 'tier2', 'tier3'] as const;
export type PriceTier = (typeof PRICE_TIERS)[number];

export function isPriceTier(value: unknown): value is PriceTier {
  return typeof value === 'string' && (PRICE_TIERS as readonly string[]).includes(value);
}

/**
 * Countries (ISO 3166-1 alpha-2) priced at `tier3`: lower-middle-income
 * markets where Octree already gets sign-ups. Countries Stripe cannot take
 * payments from are left out on purpose.
 */
const TIER3_COUNTRIES = new Set([
  // South Asia
  'IN', 'PK', 'BD', 'NP', 'LK',
  // North Africa and the Middle East
  'EG', 'DZ', 'TN', 'MA', 'JO', 'LB', 'IQ',
  // Sub-Saharan Africa
  'NG', 'KE', 'GH', 'ET', 'TZ', 'UG', 'RW', 'CM', 'CI', 'SN', 'ZM', 'MZ', 'BJ', 'BF', 'MG', 'MW',
  // Southeast Asia
  'VN', 'ID', 'PH', 'MM', 'KH', 'LA',
  // Central Asia, Eastern Europe
  'UZ', 'KG', 'TJ', 'UA', 'MD',
  // Latin America
  'BO', 'HN', 'NI', 'GT', 'SV',
]);

/** Countries priced at `tier2`: upper-middle-income markets. */
const TIER2_COUNTRIES = new Set([
  // Latin America
  'BR', 'MX', 'CO', 'PE', 'AR', 'CL', 'EC', 'PY', 'UY', 'CR', 'DO', 'PA', 'JM', 'VE',
  // Europe and Central Asia
  'TR', 'RS', 'BA', 'AL', 'MK', 'ME', 'GE', 'AM', 'AZ', 'KZ',
  // Asia
  'CN', 'TH', 'MY', 'MN',
  // Africa
  'ZA', 'NA', 'BW', 'MU',
]);

/** The price tier for an ISO country code; `standard` when unknown. */
export function priceTierForCountry(country: string | null | undefined): PriceTier {
  const code = typeof country === 'string' ? country.trim().toUpperCase() : '';
  if (TIER3_COUNTRIES.has(code)) return 'tier3';
  if (TIER2_COUNTRIES.has(code)) return 'tier2';
  return 'standard';
}

/** Everything the app sells, by checkout plan id (lib/checkout-plans.ts). */
export type RegionalPlan =
  | 'monthly'
  | 'annual'
  | 'semester'
  | 'credits_100'
  | 'generate_single'
  | 'export_single'
  | 'deadline_pass';

export type RegionalTier = Exclude<PriceTier, 'standard'>;

/**
 * Regional prices in US cents per plan. The list prices live in one place,
 * lib/stripe-prices.ts (PRICE_DEFINITIONS) with their display copy in
 * data/constants.ts; these keep the plans in the same proportion, so annual
 * still saves about a third over twelve months.
 */
export const REGIONAL_AMOUNT_CENTS: Record<RegionalPlan, Record<RegionalTier, number>> = {
  monthly: { tier2: 599, tier3: 399 },
  annual: { tier2: 4700, tier3: 3100 },
  semester: { tier2: 1700, tier3: 1200 },
  credits_100: { tier2: 300, tier3: 200 },
  generate_single: { tier2: 199, tier3: 99 },
  export_single: { tier2: 299, tier3: 199 },
  // Same list price as export_single ($4.99), so the same regional amounts.
  deadline_pass: { tier2: 299, tier3: 199 },
};

export function regionalAmountCents(plan: RegionalPlan, tier: RegionalTier): number {
  return REGIONAL_AMOUNT_CENTS[plan][tier];
}

/**
 * The Stripe `lookup_key` of a plan's price in a tier: the list price keeps
 * its key, a regional one gets a `__tier2` / `__tier3` suffix.
 */
export function regionalLookupKey(baseLookupKey: string, tier: PriceTier): string {
  return tier === 'standard' ? baseLookupKey : `${baseLookupKey}__${tier}`;
}

/** The list-price lookup key behind a (possibly regional) one. */
export function baseLookupKey(lookupKey: string): string {
  return lookupKey.replace(/__(tier2|tier3)$/, '');
}

/** "$9.99", "$79", "$0.99": whole dollars without cents. */
export function formatUsd(cents: number): string {
  return cents % 100 === 0 ? `$${cents / 100}` : `$${(cents / 100).toFixed(2)}`;
}

/** Vercel sets this on every request to a deployment. */
export const COUNTRY_HEADER = 'x-vercel-ip-country';

/**
 * The visitor's country from the request headers. Outside production
 * `PRICING_COUNTRY_OVERRIDE` (e.g. `IN`) stands in for it, so regional
 * prices can be tried locally and on previews.
 */
export function countryFromHeaders(
  headers: Pick<Headers, 'get'>,
  env: Record<string, string | undefined> = process.env
): string | null {
  const override = env.VERCEL_ENV !== 'production' ? env.PRICING_COUNTRY_OVERRIDE : undefined;
  const raw = override || headers.get(COUNTRY_HEADER);
  const code = raw?.trim().toUpperCase();
  return code && /^[A-Z]{2}$/.test(code) ? code : null;
}
