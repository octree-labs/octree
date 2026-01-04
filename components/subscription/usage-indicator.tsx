'use client';

import { useState, useEffect } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { CreditCard, Info } from 'lucide-react';
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

  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <Badge
        variant={
          limitReached || monthlyLimitReached ? 'destructive' : 'secondary'
        }
        className="text-xs"
      >
        {usageData.isPro
          ? `${monthlyEditCount}/${PRO_MONTHLY_EDIT_LIMIT}`
          : `${editCount}/${FREE_DAILY_EDIT_LIMIT}`}
      </Badge>
      {limitReached || monthlyLimitReached ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <Info className="h-4 w-4 cursor-help text-neutral-500" />
          </TooltipTrigger>
          <TooltipContent>Please Subscribe to continue using AI</TooltipContent>
        </Tooltip>
      ) : (
        <Info className="h-4 w-4 text-neutral-500" />
      )}
      <span className="text-xs text-neutral-600">
        {usageData.isPro
          ? monthlyLimitReached
            ? 'Monthly limit reached'
            : `${remainingMonthlyEdits} monthly edits left`
          : limitReached
            ? 'No free edits left'
            : `${remainingEdits} free edits left`}
      </span>
    </div>
  );
}
