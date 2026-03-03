'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { CreditCard, Info, Sparkles } from 'lucide-react';
import {
  FREE_DAILY_EDIT_LIMIT,
  PRO_MONTHLY_EDIT_LIMIT,
} from '@/data/constants';

interface UsageIndicatorProps {
  className?: string;
}

interface UsageData {
  editCount: number;
  monthlyEditCount: number;
  remainingEdits: number | null;
  remainingMonthlyEdits: number | null;
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
      const response = await fetch('/api/checkout-session', {
        method: 'POST',
      });

      if (response.ok) {
        const checkoutUrl = await response.text();
        window.location.href = checkoutUrl;
      } else {
        console.error('Failed to create checkout session');
      }
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
      className="h-8 gap-1.5 bg-gradient-to-b from-primary-light to-primary px-3 text-white hover:from-primary-light/90 hover:to-primary/90"
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
    return (
      <div className={`flex items-center gap-2 ${className}`}>
        <div className="h-4 w-16 animate-pulse rounded bg-neutral-200" />
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
      const response = await fetch('/api/checkout-session', {
        method: 'POST',
      });

      if (response.ok) {
        const checkoutUrl = await response.text();
        window.location.href = checkoutUrl;
      } else {
        console.error('Failed to create checkout session');
      }
    } catch (error) {
      console.error('Error creating checkout session:', error);
    }
  };

  const isAtLimit = limitReached || monthlyLimitReached;
  const remaining = usageData.isPro ? remainingMonthlyEdits : remainingEdits;
  const total = usageData.isPro ? PRO_MONTHLY_EDIT_LIMIT : FREE_DAILY_EDIT_LIMIT;
  const used = usageData.isPro ? monthlyEditCount : editCount;
  const progressPercent = Math.min((used / total) * 100, 100);

  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <div className="relative">
        <div
          className="flex items-center gap-1.5 rounded-md px-1.5 py-1 transition-colors hover:bg-neutral-100"
          onMouseEnter={handleEnter}
          onMouseLeave={handleLeave}
        >
          <Badge
            variant={isAtLimit ? 'destructive' : 'secondary'}
            className="cursor-default text-xs"
          >
            {used}/{total}
          </Badge>
          <Info className="h-4 w-4 cursor-help text-neutral-500" />
        </div>

        {showCard && (
          <div
            className="absolute left-1/2 top-full z-50 pt-2"
            onMouseEnter={handleEnter}
            onMouseLeave={handleLeave}
          >
            <div className="-translate-x-1/2 w-64 rounded-lg bg-white p-0 shadow-lg ring-1 ring-neutral-200">
              <div className="p-3">
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-xs font-semibold text-neutral-900">
                    {usageData.isPro ? 'Monthly Usage' : 'Daily Usage'}
                  </span>
                  {!usageData.isPro && (
                    <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-[10px] font-medium text-neutral-500">
                      Free Plan
                    </span>
                  )}
                </div>

                <div className="mb-1 flex items-baseline justify-between">
                  <span className={`text-2xl font-bold ${isAtLimit ? 'text-red-600' : 'text-neutral-900'}`}>
                    {remaining ?? 0}
                  </span>
                  <span className="text-xs text-neutral-500">
                    of {total} edits {usageData.isPro ? '/ month' : '/ day'}
                  </span>
                </div>

                <div className="mb-3 h-1.5 w-full overflow-hidden rounded-full bg-neutral-100">
                  <div
                    className={`h-full rounded-full transition-all ${
                      isAtLimit
                        ? 'bg-red-500'
                        : progressPercent > 60
                          ? 'bg-amber-500'
                          : 'bg-emerald-500'
                    }`}
                    style={{ width: `${progressPercent}%` }}
                  />
                </div>

                {isAtLimit ? (
                  <p className="text-xs text-red-600">
                    {usageData.isPro
                      ? 'Monthly limit reached. Resets next billing cycle.'
                      : 'No free edits left. Resets tomorrow.'}
                  </p>
                ) : (
                  <p className="text-xs text-neutral-500">
                    {usageData.isPro
                      ? `${remaining} edits remaining this month`
                      : `${remaining} free edits remaining today`}
                  </p>
                )}
              </div>

              {!usageData.isPro && (
                <div className="border-t border-neutral-100 px-3 py-2.5">
                  <button
                    onClick={handleSubscribe}
                    className="flex w-full items-center justify-center gap-1.5 rounded-md bg-gradient-to-b from-primary-light to-primary px-3 py-1.5 text-xs font-medium text-white transition-opacity hover:opacity-90"
                  >
                    <Sparkles className="h-3 w-3" />
                    Upgrade to Pro
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {isAtLimit && !usageData.isPro && (
        <Button
          size="sm"
          onClick={handleSubscribe}
          className="h-7 gap-1.5 bg-gradient-to-b from-primary-light to-primary px-3 text-white hover:from-primary-light/90 hover:to-primary/90"
        >
          <CreditCard className="h-3 w-3" />
          <span className="text-xs font-medium">Subscribe</span>
        </Button>
      )}
    </div>
  );
}
