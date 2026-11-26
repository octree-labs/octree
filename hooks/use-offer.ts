'use client';

import { useEffect, useState } from 'react';
import useSWR from 'swr';

import { isOfferVariant } from '@/lib/offer-v2/variant';
import type { OfferResponse } from '@/lib/offer-v2/offer';

const CONTROL: OfferResponse = { variant: 'control' };

async function fetchOffer(url: string): Promise<OfferResponse> {
  try {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) return CONTROL;
    const body = (await res.json()) as OfferResponse;
    return isOfferVariant(body?.variant) ? body : CONTROL;
  } catch {
    return CONTROL;
  }
}

/**
 * The user's paywall variant and offer_v2 details from GET /api/offer
 * (`onboarding-offer-v2`). `offer` is undefined while loading; any failure
 * resolves to `control`. One request per page, shared by every caller.
 */
export function useOffer({ enabled = true }: { enabled?: boolean } = {}): OfferResponse | undefined {
  const { data } = useSWR(enabled ? '/api/offer' : null, fetchOffer, {
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
    dedupingInterval: 10 * 60 * 1000,
  });
  return data;
}

/** Milliseconds until `endsAt`, ticking every `intervalMs`; null without a deadline. */
export function useCountdown(endsAt: string | null | undefined, intervalMs = 30_000): number | null {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!endsAt) return;
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [endsAt, intervalMs]);
  if (!endsAt) return null;
  const end = Date.parse(endsAt);
  return Number.isFinite(end) ? end - now : null;
}
