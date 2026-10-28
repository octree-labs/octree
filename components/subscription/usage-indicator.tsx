'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { CreditCard } from 'lucide-react';
import { Sparkles } from '@/components/icons/sparkles';
import {
  FREE_DAILY_EDIT_LIMIT,
  PRO_MONTHLY_EDIT_LIMIT,
} from '@/data/constants';
import { createCheckoutSession } from '@/lib/requests/subscription';
import { cn } from '@/lib/utils';

type UsageTone = 'ok' | 'low' | 'limit';

// Sits in the chat input's footer, next to the send button.
const PILL = 'flex h-6 items-center gap-1.5 rounded-full border px-2 text-xs font-medium';

const TONE_BAR: Record<UsageTone, string> = {
  ok: 'bg-primary',
  low: 'bg-amber-500',
  limit: 'bg-red-500',
};

const TONE_STROKE: Record<UsageTone, string> = {
  ok: 'stroke-primary',
  low: 'stroke-amber-500',
  limit: 'stroke-red-500',
};

/** A 16px ring that fills as the allowance is used. */
function UsageRing({ percent, tone }: { percent: number; tone: UsageTone }) {
  const radius = 6;
  const circumference = 2 * Math.PI * radius;
  return (
    <svg viewBox="0 0 16 16" className="size-3.5 shrink-0 -rotate-90" aria-hidden="true">
      <circle cx="8" cy="8" r={radius} fill="none" strokeWidth="2.5" className="stroke-slate-200" />
      <circle
        cx="8"
        cy="8"
        r={radius}
        fill="none"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={circumference * (1 - percent / 100)}
        className={cn('transition-[stroke-dashoffset]', TONE_STROKE[tone], percent === 0 && 'opacity-0')}
      />
    </svg>
  );
}

interface UsageIndicatorProps {
  className?: string;
}

interface UsageData {
  editCount: number;
  monthlyEditCount: number;
  remainingEdits: number | null;
  remainingMonthlyEdits: number | null;
  /** Purchased AI edits left; never expire. */
  editCredits?: number;
  isPro: boolean;
  limitReached: boolean;
  monthlyLimitReached: boolean;
  monthlyResetDate: string | null;
  hasUnlimitedEdits: boolean;
}

export function UpgradeButton() {
  const [usageData, setUsageData] = useState<UsageData | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    const fetchUsageData = async () => {
      try {
        const response = await fetch('/api/subscription-status');
        if (response.ok) {
          const data = await response.json();
          setUsageData(data.usage);
        }
      } catch (error) {
        console.error('Error fetching usage data:', error);
      }
    };

    fetchUsageData();
    const handleUsageUpdate = () => fetchUsageData();
    window.addEventListener('usage-update', handleUsageUpdate);
    return () => window.removeEventListener('usage-update', handleUsageUpdate);
  }, []);

  const handleSubscribe = async () => {
    setIsLoading(true);
    try {
      const checkoutUrl = await createCheckoutSession({ plan: 'monthly', source: 'toolbar' });
      window.location.href = checkoutUrl;
    } catch (error) {
      console.error('Error creating checkout session:', error);
    } finally {
      setIsLoading(false);
    }
  };

  if (!usageData) return null;
  if (usageData.hasUnlimitedEdits) return null;
  if (usageData.isPro) return null;

  return (
    <Button
      size="sm"
      onClick={handleSubscribe}
      disabled={isLoading}
      className="h-8 gap-1.5 px-3"
    >
      <CreditCard className="h-3.5 w-3.5" />
      <span className="font-medium">
        {isLoading ? 'Loading...' : 'Subscribe'}
      </span>
    </Button>
  );
}

export function UsageIndicator({ className }: UsageIndicatorProps) {
  const [usageData, setUsageData] = useState<UsageData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [showCard, setShowCard] = useState(false);
  const closeTimeout = useRef<NodeJS.Timeout | null>(null);
  // Losing focus closes the card only when the pointer isn't on it, so a
  // click on "Upgrade to Pro" after clicking the pill still lands.
  const hovering = useRef(false);

  useEffect(() => {
    fetchUsageData();
    const handleUsageUpdate = () => {
      fetchUsageData();
    };
    window.addEventListener('usage-update', handleUsageUpdate);
    return () => {
      window.removeEventListener('usage-update', handleUsageUpdate);
    };
  }, []);

  const fetchUsageData = async () => {
    setIsLoading(true);
    try {
      const response = await fetch('/api/subscription-status');
      if (response.ok) {
        const data = await response.json();
        setUsageData(data.usage);
      }
    } catch (error) {
      console.error('Error fetching usage data:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleEnter = useCallback(() => {
    if (closeTimeout.current) {
      clearTimeout(closeTimeout.current);
      closeTimeout.current = null;
    }
    setShowCard(true);
  }, []);

  const handleLeave = useCallback(() => {
    closeTimeout.current = setTimeout(() => setShowCard(false), 50);
  }, []);

  if (isLoading) {
    // The pill's own shell, sized by the usual label, so nothing shifts when the count arrives.
    return (
      <div
        aria-hidden="true"
        className={cn(PILL, 'border-slate-200 bg-white', className)}
      >
        <UsageRing percent={0} tone="ok" />
        <span className="relative">
          <span className="invisible">5 edits left</span>
          <span className="absolute inset-x-0 top-1/2 h-3 -translate-y-1/2 animate-pulse rounded bg-slate-100" />
        </span>
      </div>
    );
  }

  if (!usageData) {
    return null;
  }

  if (usageData.hasUnlimitedEdits) {
    return null;
  }

  // Don't show for pro users who haven't hit monthly limit
  if (usageData.isPro && !usageData.monthlyLimitReached) {
    return null;
  }

  const {
    editCount,
    monthlyEditCount,
    remainingEdits,
    remainingMonthlyEdits,
    limitReached,
    monthlyLimitReached,
  } = usageData;

  const handleSubscribe = async () => {
    try {
      const checkoutUrl = await createCheckoutSession({ plan: 'monthly', source: 'toolbar' });
      window.location.href = checkoutUrl;
    } catch (error) {
      console.error('Error creating checkout session:', error);
    }
  };

  const isAtLimit = limitReached || monthlyLimitReached;
  const editCredits = usageData.editCredits ?? 0;
  const remaining = usageData.isPro ? remainingMonthlyEdits : remainingEdits;
  const total = usageData.isPro ? PRO_MONTHLY_EDIT_LIMIT : FREE_DAILY_EDIT_LIMIT;
  const used = usageData.isPro ? monthlyEditCount : editCount;
  const progressPercent = Math.min((used / total) * 100, 100);

  const tone = isAtLimit ? 'limit' : progressPercent > 60 ? 'low' : 'ok';
  const period = usageData.isPro ? 'this month' : 'today';

  return (
    <div className={cn('flex items-center gap-2', className)}>
      <div
        className="relative"
        onMouseEnter={() => {
          hovering.current = true;
          handleEnter();
        }}
        onMouseLeave={() => {
          hovering.current = false;
          handleLeave();
        }}
      >
        <button
          type="button"
          onFocus={handleEnter}
          onBlur={() => {
            if (!hovering.current) handleLeave();
          }}
          aria-expanded={showCard}
          aria-label={`AI edits: ${remaining ?? 0} of ${total} left ${period}`}
          className={cn(
            PILL,
            'transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30',
            isAtLimit
              ? 'border-red-200 bg-red-50 text-red-700 hover:bg-red-100'
              : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50',
            showCard && (isAtLimit ? 'bg-red-100' : 'bg-slate-50')
          )}
        >
          <UsageRing percent={progressPercent} tone={tone} />
          <span className="tabular-nums">
            {isAtLimit ? 'No edits left' : `${remaining ?? 0} edit${remaining === 1 ? '' : 's'} left`}
          </span>
        </button>

        {showCard && (
          <div className="absolute bottom-full left-0 z-50 pb-2">
            <div className="w-56 rounded-lg bg-white p-2.5 shadow-lg ring-1 ring-slate-200">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs text-slate-500">
                  <span className={cn('text-sm font-semibold tabular-nums', isAtLimit ? 'text-red-600' : 'text-slate-900')}>
                    {remaining ?? 0}
                  </span>{' '}
                  of {total} left {period}
                </p>
                <span className="shrink-0 rounded-full bg-slate-100 px-1.5 py-px text-[10px] font-medium text-slate-600">
                  {usageData.isPro ? 'Pro' : 'Free'}
                </span>
              </div>

              <div className="my-2 h-1 w-full overflow-hidden rounded-full bg-slate-100">
                <div
                  className={cn('h-full rounded-full transition-all', TONE_BAR[tone])}
                  style={{ width: `${progressPercent}%` }}
                />
              </div>

              <p className={cn('text-[11px] leading-snug', isAtLimit ? 'text-red-600' : 'text-slate-500')}>
                {isAtLimit
                  ? usageData.isPro
                    ? 'Monthly limit reached. Resets next billing cycle, or buy 100 edits for $5 in Settings.'
                    : 'No free edits left. Resets tomorrow, or buy 100 edits for $5.'
                  : usageData.isPro
                    ? 'Resets with your billing cycle.'
                    : 'Resets every day.'}
                {editCredits > 0 &&
                  ` +${editCredits} purchased ${editCredits === 1 ? 'credit' : 'credits'}, used after these.`}
              </p>

              {!usageData.isPro && (
                <Button size="xs" onClick={handleSubscribe} className="mt-2 h-7 w-full text-xs">
                  <Sparkles className="size-3" />
                  Upgrade to Pro
                </Button>
              )}
            </div>
          </div>
        )}
      </div>

      {isAtLimit && !usageData.isPro && (
        <Button
          type="button"
          size="xs"
          onClick={handleSubscribe}
          className="h-6 gap-1 rounded-full px-2.5"
        >
          <CreditCard className="size-3" />
          <span className="text-xs font-medium">Subscribe</span>
        </Button>
      )}
    </div>
  );
}
