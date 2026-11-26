'use client';

import { useEffect, useState } from 'react';
import useSWR from 'swr';

import { createClient } from '@/lib/supabase/client';
import { isOfferVariant } from '@/lib/offer-v2/variant';
import type { OfferResponse } from '@/lib/offer-v2/offer';

const CONTROL: OfferResponse = { variant: 'control' };

/** GET /api/offer is given this long; after it the page goes on as control. */
export const OFFER_FETCH_TIMEOUT_MS = 4000;

export async function fetchOffer(url: string, timeoutMs: number = OFFER_FETCH_TIMEOUT_MS): Promise<OfferResponse> {
  try {
    const res = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return CONTROL;
    const body = (await res.json()) as OfferResponse;
    return isOfferVariant(body?.variant) ? body : CONTROL;
  } catch {
    // Network error, abort on timeout, bad JSON: never leave the paywall waiting.
    return CONTROL;
  }
}

/** The signed-in user's id from the local session (no network). */
function useSessionUserId(enabled: boolean): string | null | undefined {
  const [userId, setUserId] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    let session: ReturnType<ReturnType<typeof createClient>['auth']['getSession']>;
    try {
      session = createClient().auth.getSession();
    } catch {
      // No Supabase config (tests, a broken env): answer without a user id.
      setUserId(null);
      return;
    }
    session
      .then(({ data }) => {
        if (!cancelled) setUserId(data.session?.user?.id ?? null);
      })
      .catch(() => {
        if (!cancelled) setUserId(null);
      });
    return () => {
      cancelled = true;
    };
  }, [enabled]);
  return userId;
}

/**
 * The user's paywall arm and offer_v2 details from GET /api/offer
 * (`onboarding-offer-v2`; the call assigns the arm, so only call it where a
 * paywall is shown). Keyed on the user id so a different account in the same
 * tab gets its own answer. `undefined` while loading (at most
 * OFFER_FETCH_TIMEOUT_MS); any failure resolves to `control`.
 */
export function useOffer({ enabled = true }: { enabled?: boolean } = {}): OfferResponse | undefined {
  const userId = useSessionUserId(enabled);
  const key = enabled && userId !== undefined ? ['/api/offer', userId ?? 'anonymous'] : null;
  const { data } = useSWR(key, ([url]) => fetchOffer(url), {
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
