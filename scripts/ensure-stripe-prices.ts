/**
 * Pre-creates the Stripe prices the app sells and prints their ids.
 *
 * The app creates each price on its first use (lib/stripe-prices.ts), so this
 * is optional; run it once per Stripe mode to see the ids up front and keep
 * the first checkout of each plan off the creation path:
 *
 *   STRIPE_SECRET_KEY=sk_live_... npx tsx scripts/ensure-stripe-prices.ts
 *
 * Idempotent: an existing active price with the same `lookup_key` is reused.
 * The monthly plan resolves to the pre-existing price id from
 * lib/stripe-config.ts for the key's mode and is never recreated.
 */
import Stripe from 'stripe';

import {
  PRICE_DEFINITIONS,
  PRICE_LOOKUP_KEYS,
  getOrCreatePrice,
  type PriceLookupKey,
} from '../lib/stripe-prices';

async function main() {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) {
    console.error('STRIPE_SECRET_KEY is not set.');
    process.exit(1);
  }

  const stripe = new Stripe(secretKey);
  const mode = secretKey.startsWith('sk_live_') ? 'live' : 'test';
  console.log(`Ensuring Octree prices in Stripe ${mode} mode...\n`);

  for (const [plan, lookupKey] of Object.entries(PRICE_LOOKUP_KEYS) as [string, PriceLookupKey][]) {
    const def = PRICE_DEFINITIONS[lookupKey];
    const priceId = await getOrCreatePrice(lookupKey, stripe);
    const price = await stripe.prices.retrieve(priceId);
    const amount = `$${(def.unitAmount / 100).toFixed(2)}`;
    const cadence = def.recurring
      ? `every ${def.recurring.interval_count ?? 1} ${def.recurring.interval}`
      : 'one-time';
    const note = price.lookup_key === lookupKey ? '' : ' (pre-existing price without this lookup key)';
    console.log(`${plan.padEnd(12)} ${lookupKey.padEnd(22)} ${priceId}  ${amount} ${cadence}${note}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
