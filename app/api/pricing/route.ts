import { NextResponse } from 'next/server';
import { headers } from 'next/headers';

import { countryFromHeaders, priceTierForCountry } from '@/lib/regional-pricing';

export const dynamic = 'force-dynamic';

/**
 * The visitor's price tier (lib/regional-pricing.ts), from the country
 * Vercel resolves for the request. The browser turns it into display prices
 * with `pricingCatalog()`; /api/checkout-session resolves the tier the same
 * way on its own, so what is shown and what is charged come from one rule.
 * No auth: the answer depends only on the request's own IP country.
 */
export async function GET() {
  const country = countryFromHeaders(await headers());
  return NextResponse.json(
    { country, tier: priceTierForCountry(country) },
    { headers: { 'Cache-Control': 'private, max-age=3600' } }
  );
}
