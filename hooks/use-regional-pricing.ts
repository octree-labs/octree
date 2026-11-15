'use client';

import useSWR from 'swr';

import { isPriceTier, type PriceTier } from '@/lib/regional-pricing';
import { pricingCatalog, STANDARD_PRICING, type PricingCatalog } from '@/lib/pricing-catalog';

const catalogs = new Map<PriceTier, PricingCatalog>([['standard', STANDARD_PRICING]]);

function catalogFor(tier: PriceTier): PricingCatalog {
  let catalog = catalogs.get(tier);
  if (!catalog) {
    catalog = pricingCatalog(tier);
    catalogs.set(tier, catalog);
  }
  return catalog;
}

async function fetchTier(url: string): Promise<PriceTier> {
  const res = await fetch(url);
  if (!res.ok) return 'standard';
  const body = (await res.json()) as { tier?: unknown };
  return isPriceTier(body.tier) ? body.tier : 'standard';
}

/**
 * The prices to show this visitor: the list prices until GET /api/pricing
 * answers (or if it fails), then the regional ones for their country. Every
 * component that asks shares one request; it is refreshed when the tab
 * regains focus, so a visitor whose network changed sees the new tier.
 * `enabled: false` skips the request (a component that shows a price only
 * in some states).
 */
export function useRegionalPricing({ enabled = true }: { enabled?: boolean } = {}): PricingCatalog {
  const { data } = useSWR(enabled ? '/api/pricing' : null, fetchTier, {
    revalidateOnReconnect: false,
    dedupingInterval: 5 * 60 * 1000,
    focusThrottleInterval: 5 * 60 * 1000,
  });
  return catalogFor(data ?? 'standard');
}
