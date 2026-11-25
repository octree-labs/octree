'use client';

import { useEffect, useRef } from 'react';

import { Button } from '@/components/ui/button';
import { FREE_DAILY_EDIT_LIMIT } from '@/data/constants';
import { track } from '@/lib/analytics/track';
import { AnalyticsEvents } from '@/lib/analytics/events';

interface PlanStepActionsProps {
  /** data/constants.ts ONBOARDING_PAYWALL_REQUIRED: no free path when true. */
  paywallRequired: boolean;
  isSubmitting: boolean;
  onCheckout: () => void;
  onContinueFree: () => void;
  onSignOut: () => void;
}

/**
 * The buttons under the onboarding plan picker. With the onboarding paywall
 * on, the only way forward is Stripe Checkout; "Use a different account"
 * stays so nobody is stuck on a paywall with the wrong login. With it off,
 * "Continue with the free plan" is offered as before.
 *
 * `paywall_shown` (placement `onboarding`) fires once per visit to the step
 * while the paywall is on. The onboarding page only renders for users who
 * are not onboarded and not Pro (app/onboarding/layout.tsx).
 */
export function PlanStepActions({
  paywallRequired,
  isSubmitting,
  onCheckout,
  onContinueFree,
  onSignOut,
}: PlanStepActionsProps) {
  const tracked = useRef(false);

  useEffect(() => {
    if (!paywallRequired || tracked.current) return;
    tracked.current = true;
    track(AnalyticsEvents.PAYWALL_SHOWN, {
      feature: 'onboarding',
      reason: 'onboarding_required',
      offers: ['pro'],
      placement: 'onboarding',
    });
  }, [paywallRequired]);

  return (
    <div className="space-y-3">
      <Button className="w-full" variant="gradient" onClick={onCheckout} disabled={isSubmitting}>
        {isSubmitting ? 'Loading...' : 'Get Octree Pro →'}
      </Button>
      {paywallRequired ? (
        <p className="text-center text-xs text-muted-foreground">
          Secure checkout with Stripe. Cancel anytime.{' '}
          <button
            type="button"
            onClick={onSignOut}
            disabled={isSubmitting}
            className="underline underline-offset-2 hover:text-foreground"
          >
            Use a different account
          </button>
        </p>
      ) : (
        <div className="space-y-2">
          <Button className="w-full" variant="outline" onClick={onContinueFree} disabled={isSubmitting}>
            Continue with the free plan
          </Button>
          <p className="text-center text-xs text-muted-foreground">
            Free includes {FREE_DAILY_EDIT_LIMIT} AI edits a day. Upgrade anytime.
          </p>
        </div>
      )}
    </div>
  );
}
