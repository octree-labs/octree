'use client';

import { useEffect } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { PaywallActions } from '@/stores/paywall';

/**
 * `?upgrade=1` (the link in the limit-hit and win-back emails) opens the
 * paywall dialog on arrival and then drops the parameter from the URL so a
 * reload or a dismissal does not reopen it. Needs a `PaywallDialog` mounted
 * in the same tree.
 */
export function UpgradeParam() {
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const upgrade = searchParams.get('upgrade');

  useEffect(() => {
    if (upgrade !== '1') return;
    PaywallActions.open('ai-edit', 'daily_limit');
    const next = new URLSearchParams(searchParams.toString());
    next.delete('upgrade');
    const query = next.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }, [upgrade, pathname, router, searchParams]);

  return null;
}
