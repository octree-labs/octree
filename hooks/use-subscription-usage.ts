'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  toFeatureUsage,
  type FeatureUsage,
  type SubscriptionStatusResponse,
} from '@/lib/subscription/features';

/**
 * One request in flight at a time, shared by every mounted consumer. The
 * editor toolbar, the past-due banner and the generate page each call this
 * hook on the same page load, and the route behind it reads Stripe on every
 * call; concurrent mounts now share a single fetch.
 */
let inflight: Promise<FeatureUsage | null> | null = null;

function fetchUsage(): Promise<FeatureUsage | null> {
  if (!inflight) {
    inflight = (async () => {
      const res = await fetch('/api/subscription-status');
      if (!res.ok) return null;
      const data = (await res.json()) as SubscriptionStatusResponse;
      return toFeatureUsage(data);
    })().finally(() => {
      inflight = null;
    });
  }
  return inflight;
}

/**
 * The current user's plan and limit state from GET /api/subscription-status,
 * in the shape `canUseFeature` expects. `usage` is null until loaded.
 * Re-fetches on the global `usage-update` event (dispatched after AI edits).
 */
export function useSubscriptionUsage() {
  const [usage, setUsage] = useState<FeatureUsage | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const next = await fetchUsage();
      if (next) setUsage(next);
    } catch (error) {
      console.error('Error fetching subscription status:', error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    window.addEventListener('usage-update', refresh);
    return () => window.removeEventListener('usage-update', refresh);
  }, [refresh]);

  return { usage, isLoading, refresh };
}
