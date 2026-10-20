'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { AlertCircle, PauseCircle } from 'lucide-react';
import { CREDIT_PACKS, FREE_DAILY_EDIT_LIMIT, PRO_MONTHLY_EDIT_LIMIT } from '@/data/constants';
import { CancelDialog } from '@/components/subscription/cancel-dialog';
import { PlanPicker, type PickerPlan } from '@/components/subscription/plan-picker';
import { SettingsCard, SettingsRow } from '@/components/settings/settings-card';
import { SettingsCardSkeleton } from '@/components/settings/settings-card-skeleton';
import { createCheckoutSession, resumeSubscription } from '@/lib/requests/subscription';
import { describePlanPeriod } from '@/lib/stripe-subscription';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

interface SubscriptionData {
  hasSubscription: boolean;
  subscription: {
    id: string;
    status: string;
    cancel_at_period_end: boolean;
    current_period_end: number;
    current_period_start: number;
    /** `paused` once a paused subscription's paid period has ended. */
    effective_status: string;
    /** Unix seconds; set while collection is paused. */
    paused_until: number | null;
    /** Unix seconds; while paused, Pro stays on until then. */
    pause_paid_through: number | null;
    has_discount: boolean;
    discount_coupon_id: string | null;
    items: Array<{
      id: string;
      price: {
        id: string;
        unit_amount: number;
        currency: string;
        recurring: {
          interval: string;
          interval_count?: number | null;
        } | null;
        lookup_key?: string | null;
      };
    }>;
  } | null;
  usage: {
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
  };
}

export function SubscriptionStatus() {
  const [subscriptionData, setSubscriptionData] =
    useState<SubscriptionData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isCheckoutLoading, setIsCheckoutLoading] = useState(false);
  const [isManageLoading, setIsManageLoading] = useState(false);
  const [isResumeLoading, setIsResumeLoading] = useState(false);
  const [showCancelDialog, setShowCancelDialog] = useState(false);
  const [plan, setPlan] = useState<PickerPlan>('monthly');
  const [isCreditsLoading, setIsCreditsLoading] = useState(false);

  useEffect(() => {
    fetchSubscriptionStatus();
  }, []);

  const fetchSubscriptionStatus = async () => {
    try {
      const response = await fetch('/api/subscription-status');
      if (response.ok) {
        const data = await response.json();
        setSubscriptionData(data);
      }
    } catch (error) {
      console.error('Error fetching subscription status:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleCheckout = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsCheckoutLoading(true);

    try {
      const checkoutUrl = await createCheckoutSession({
        plan,
        withTrial: false,
        source: 'settings',
      });
      window.location.href = checkoutUrl;
    } catch (error) {
      console.error('Error creating checkout session:', error);
      toast.error('Failed to start checkout. Please try again.');
      setIsCheckoutLoading(false);
    }
  };

  const handleBuyCredits = async () => {
    setIsCreditsLoading(true);
    try {
      const checkoutUrl = await createCheckoutSession({ plan: 'credits_100', source: 'settings' });
      window.location.href = checkoutUrl;
    } catch (error) {
      console.error('Error creating credits checkout session:', error);
      toast.error('Failed to start checkout. Please try again.');
      setIsCreditsLoading(false);
    }
  };

  const creditsRow = (credits: number) => (
    <SettingsRow label="Purchased edits" description="Never expire.">
      <div className="flex items-center gap-3">
        <span>
          {credits} {credits === 1 ? 'credit' : 'credits'} left
        </span>
        <Button
          variant="link"
          size="sm"
          className="h-auto p-0"
          onClick={handleBuyCredits}
          disabled={isCreditsLoading}
        >
          {isCreditsLoading ? 'Loading...' : `Buy ${CREDIT_PACKS.credits_100.credits} for ${CREDIT_PACKS.credits_100.price}`}
        </Button>
      </div>
    </SettingsRow>
  );

  const handleManageSubscription = async () => {
    setIsManageLoading(true);
    try {
      const response = await fetch('/api/billing-portal', {
        method: 'POST',
      });

      if (response.ok) {
        const { url } = await response.json();
        window.location.href = url;
      } else {
        console.error('Failed to create billing portal session');
      }
    } catch (error) {
      console.error('Error opening billing portal:', error);
    } finally {
      setIsManageLoading(false);
    }
  };

  const handleResume = async () => {
    setIsResumeLoading(true);
    try {
      await resumeSubscription();
      toast.success('Subscription resumed. Welcome back.');
      await fetchSubscriptionStatus();
    } catch (error) {
      console.error('Error resuming subscription:', error);
      toast.error(
        error instanceof Error ? error.message : 'Failed to resume subscription.'
      );
    } finally {
      setIsResumeLoading(false);
    }
  };

  const handleCancelDialogChange = (open: boolean) => {
    setShowCancelDialog(open);
    // Refresh subscription data when dialog closes
    if (!open) {
      fetchSubscriptionStatus();
    }
  };

  if (isLoading) {
    return <SettingsCardSkeleton rows={3} />;
  }

  if (!subscriptionData) {
    return (
      <SettingsCard
        title="Plan"
        description="Unable to load your plan. Please try again later."
      />
    );
  }

  const { hasSubscription, subscription, usage } = subscriptionData;

  if (usage.hasUnlimitedEdits && !hasSubscription) {
    return (
      <SettingsCard
        title="Unlimited AI edits"
        description="Your account has been granted unlimited AI edits."
        action={<Badge variant="secondary">Unlimited</Badge>}
      >
        <SettingsRow label="Edits this month">{usage.monthlyEditCount}</SettingsRow>
        <SettingsRow label="Lifetime edits">{usage.editCount}</SettingsRow>
      </SettingsCard>
    );
  }

  if (hasSubscription && subscription) {
    // Paused (free plan now) vs. a pause scheduled for when the paid period ends.
    const isPaused = subscription.effective_status === 'paused';
    const pauseScheduled = !isPaused && subscription.paused_until != null;
    const isActive = subscription.status === 'active' && !isPaused;
    // Stripe is retrying a failed renewal charge; Pro is off until it clears.
    const isPastDue = subscription.status === 'past_due' || subscription.status === 'unpaid';
    const isCancelling = subscription.cancel_at_period_end;
    const pausedUntil =
      subscription.paused_until != null ? new Date(subscription.paused_until * 1000) : null;
    const pausePaidThrough =
      subscription.pause_paid_through != null
        ? new Date(subscription.pause_paid_through * 1000)
        : null;
    const periodEnd = new Date(subscription.current_period_end * 1000);
    const periodStart = new Date(subscription.current_period_start * 1000);
    const hasUnlimitedAccess = usage.hasUnlimitedEdits;

    const price = subscription.items[0]?.price;
    const amount = price ? (price.unit_amount / 100).toFixed(2) : '0.00';
    const currency = price?.currency?.toUpperCase() || 'USD';
    const planPeriod = describePlanPeriod(price?.recurring, periodEnd, isCancelling);
    const editCredits = usage.editCredits ?? 0;

    const statusLabel = isPaused
      ? 'Paused'
      : isActive
        ? 'Active'
        : isPastDue
          ? 'Payment failed'
          : subscription.status.charAt(0).toUpperCase() +
            subscription.status.slice(1).toLowerCase();

    return (
      <SettingsCard
        title="Pro"
        badge={
          <Badge variant={isActive ? 'default' : isPastDue ? 'destructive' : 'secondary'}>
            {statusLabel}
          </Badge>
        }
        description={`${amount} ${currency} · ${planPeriod}`}
        action={
          <>
            {(isActive || isPaused || pauseScheduled) && !isCancelling && (
              <Button variant="outline" size="sm" onClick={() => setShowCancelDialog(true)}>
                Cancel subscription
              </Button>
            )}
            <Button size="sm" onClick={handleManageSubscription} disabled={isManageLoading}>
              {isManageLoading ? 'Loading...' : 'Manage plan'}
            </Button>
          </>
        }
      >
        {isPastDue && (
          <Notice tone="red" icon={<AlertCircle />}>
            Your last payment failed. Update your card to keep Pro.
            <NoticeAction onClick={handleManageSubscription} disabled={isManageLoading}>
              {isManageLoading ? 'Opening...' : 'Update card'}
            </NoticeAction>
          </Notice>
        )}

        {(isPaused || pauseScheduled) && (
          <Notice tone="neutral" icon={<PauseCircle />}>
            {isPaused
              ? pausedUntil
                ? `Paused until ${pausedUntil.toLocaleDateString()} · free plan until then`
                : 'Paused · free plan until you resume'
              : `Pro until ${(pausePaidThrough ?? periodEnd).toLocaleDateString()}, then paused${
                  pausedUntil ? ` until ${pausedUntil.toLocaleDateString()}` : ''
                }`}
            <NoticeAction onClick={handleResume} disabled={isResumeLoading}>
              {isResumeLoading ? 'Resuming...' : 'Resume'}
            </NoticeAction>
          </Notice>
        )}

        {isCancelling && (
          <Notice tone="orange" icon={<AlertCircle />}>
            Your subscription ends on {periodEnd.toLocaleDateString()}.
          </Notice>
        )}

        <SettingsRow label="Billing period">
          {periodStart.toLocaleDateString()} – {periodEnd.toLocaleDateString()}
        </SettingsRow>

        <SettingsRow
          label="AI edits"
          description={
            usage.monthlyResetDate
              ? `Resets on ${new Date(usage.monthlyResetDate).toLocaleDateString()}`
              : undefined
          }
        >
          {hasUnlimitedAccess ? (
            'Unlimited'
          ) : isActive ? (
            <UsageMeter used={usage.monthlyEditCount} limit={PRO_MONTHLY_EDIT_LIMIT} />
          ) : (
            `${usage.editCount} used`
          )}
        </SettingsRow>

        {!hasUnlimitedAccess && creditsRow(editCredits)}

        <CancelDialog open={showCancelDialog} onOpenChange={handleCancelDialogChange} />
      </SettingsCard>
    );
  }

  // No subscription: today's usage, then the upgrade options.
  return (
    <div className="space-y-6">
      <SettingsCard
        title="Free"
        description={`${FREE_DAILY_EDIT_LIMIT} AI edits a day.`}
      >
        <SettingsRow label="AI edits today">
          <UsageMeter used={usage.editCount} limit={FREE_DAILY_EDIT_LIMIT} />
        </SettingsRow>
        {creditsRow(usage.editCredits ?? 0)}
      </SettingsCard>

      <SettingsCard
        title="Upgrade to Pro"
        description="More AI edits every month, unlimited projects and citations."
      >
        <form onSubmit={handleCheckout} className="space-y-4 px-6 py-5">
          <PlanPicker
            plan={plan}
            onPlanChange={setPlan}
            source="settings"
            hideCredits
            disabled={isCheckoutLoading}
          />
          <Button type="submit" variant="gradient" size="sm" disabled={isCheckoutLoading}>
            {isCheckoutLoading ? 'Loading...' : 'Subscribe'}
          </Button>
        </form>
      </SettingsCard>
    </div>
  );
}

function UsageMeter({ used, limit }: { used: number; limit: number }) {
  return (
    <div className="flex items-center gap-3">
      <div className="h-1.5 w-32 rounded-full bg-neutral-200">
        <div
          className="h-1.5 rounded-full bg-primary transition-all duration-300"
          style={{ width: `${Math.min(100, (used / limit) * 100)}%` }}
        />
      </div>
      <span className="text-neutral-500">
        {used} of {limit} used
      </span>
    </div>
  );
}

const NOTICE_TONES = {
  red: 'bg-red-50 text-red-700 [&>svg]:text-red-500',
  orange: 'bg-orange-50 text-orange-700 [&>svg]:text-orange-500',
  neutral: 'bg-neutral-50 text-neutral-700 [&>svg]:text-neutral-500',
};

function Notice({
  tone,
  icon,
  children,
}: {
  tone: keyof typeof NOTICE_TONES;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        'flex items-center gap-2 px-6 py-3 text-sm [&>svg]:size-4 [&>svg]:shrink-0',
        NOTICE_TONES[tone]
      )}
    >
      {icon}
      {children}
    </div>
  );
}

function NoticeAction(props: React.ComponentProps<typeof Button>) {
  return (
    <Button
      variant="link"
      size="sm"
      className="ml-auto h-auto shrink-0 p-0 text-inherit"
      {...props}
    />
  );
}
