'use client';

import { useEffect } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useSubscriptionUsage } from '@/hooks/use-subscription-usage';
import { PaywallActions } from '@/stores/paywall';

/**
 * `?upgrade=1` (the link in the limit-hit and win-back emails) opens the
 * paywall dialog on arrival and then drops the parameter from the URL so a
 * reload or a dismissal does not reopen it. Needs a `PaywallDialog` mounted
 * in the same tree.
 *
 * The dialog opens once GET /api/subscription-status has answered (shared
 * with the page's other useSubscriptionUsage consumers, so no extra
 * request): by then the first-purchase offer is in the paywall store, the
 * dialog opens with it already shown, and `paywall_shown` carries it. A
 * failed status fetch still opens the dialog, without the offer.
 */
export function UpgradeParam() {
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const { isLoading } = useSubscriptionUsage();
  const upgrade = searchParams.get('upgrade');

  useEffect(() => {
    if (upgrade !== '1' || isLoading) return;
    PaywallActions.open('ai-edit', 'daily_limit');
    const next = new URLSearchParams(searchParams.toString());
    next.delete('upgrade');
    const query = next.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }, [upgrade, isLoading, pathname, router, searchParams]);

  return null;
}
