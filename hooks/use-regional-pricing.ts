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
 * answers (or if it fails), then the regional ones for their country. One
 * request per page load, shared by every component that asks.
 */
export function useRegionalPricing(): PricingCatalog {
  const { data } = useSWR('/api/pricing', fetchTier, {
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
    dedupingInterval: 60 * 60 * 1000,
  });
  return catalogFor(data ?? 'standard');
}
