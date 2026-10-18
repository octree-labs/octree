'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  toFeatureUsage,
  type FeatureUsage,
  type SubscriptionStatusResponse,
} from '@/lib/subscription/features';

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
      const res = await fetch('/api/subscription-status');
      if (!res.ok) return;
      const data = (await res.json()) as SubscriptionStatusResponse;
      setUsage(toFeatureUsage(data));
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
