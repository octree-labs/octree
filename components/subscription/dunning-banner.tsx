'use client';

import { useEffect, useState } from 'react';
import { AlertCircle, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { useSubscriptionUsage } from '@/hooks/use-subscription-usage';
import { AnalyticsEvents } from '@/lib/analytics/events';
import { track } from '@/lib/analytics/track';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

const DISMISSED_KEY = 'octree:dunning-banner-dismissed';

function readDismissed(): boolean {
  try {
    return window.sessionStorage.getItem(DISMISSED_KEY) === '1';
  } catch {
    return false;
  }
}

function writeDismissed(): void {
  try {
    window.sessionStorage.setItem(DISMISSED_KEY, '1');
  } catch {
    // Private mode or blocked storage: the banner simply comes back next load.
  }
}

interface DunningBannerProps {
  location: 'dashboard' | 'editor';
  className?: string;
}

/**
 * "Your last payment failed" strip, shown while GET /api/subscription-status
 * reports a past_due / unpaid subscription (Stripe is retrying the card and
 * Pro is off until it succeeds). Dismissable for the browser session; the
 * button opens the Stripe billing portal, where the card can be changed and
 * the open invoice paid.
 */
export function DunningBanner({ location, className }: DunningBannerProps) {
  const { usage } = useSubscriptionUsage();
  const [dismissed, setDismissed] = useState(true);
  const [isOpening, setIsOpening] = useState(false);

  useEffect(() => {
    setDismissed(readDismissed());
  }, []);

  if (!usage?.paymentPastDue || dismissed) return null;

  const openBillingPortal = async () => {
    track(AnalyticsEvents.DUNNING_BANNER_CLICKED, { location });
    setIsOpening(true);
    try {
      const response = await fetch('/api/billing-portal', { method: 'POST' });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.url) {
        throw new Error(data.error || 'Could not open the billing portal');
      }
      window.location.href = data.url;
    } catch (error) {
      console.error('Error opening billing portal:', error);
      toast.error('Could not open billing. Try again from Settings.');
      setIsOpening(false);
    }
  };

  const dismiss = () => {
    writeDismissed();
    setDismissed(true);
  };

  return (
    <div
      role="status"
      className={cn(
        'flex flex-shrink-0 items-center gap-3 border-b border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900',
        className
      )}
    >
      <AlertCircle className="size-4 shrink-0 text-amber-600" />
      <p className="min-w-0 flex-1 truncate">
        <span className="font-medium">Your last payment failed.</span> Update your card to keep Pro.
      </p>
      <Button
        size="xs"
        variant="outline"
        onClick={openBillingPortal}
        disabled={isOpening}
        className="shrink-0 border-amber-300 bg-white text-amber-900 hover:bg-amber-100"
      >
        {isOpening ? 'Opening...' : 'Update card'}
      </Button>
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss"
        className="shrink-0 rounded p-1 text-amber-700 transition-colors hover:bg-amber-100 hover:text-amber-900"
      >
        <X className="size-4" />
      </button>
    </div>
  );
}
