'use client';

import { useState, useEffect } from 'react';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { CreditCard, AlertCircle, CheckCircle, Zap } from 'lucide-react';
import { PRO_MONTHLY_EDIT_LIMIT } from '@/data/constants';
import { CancelSubscriptionDialog } from '@/components/subscription/cancel-subscription-dialog';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { FeatureList } from '@/app/onboarding/components/feature-list';
import { createCheckoutSession } from '@/lib/requests/subscription';
import { toast } from 'sonner';

interface SubscriptionData {
  hasSubscription: boolean;
  subscription: {
    id: string;
    status: string;
    cancel_at_period_end: boolean;
    current_period_end: number;
    current_period_start: number;
    items: Array<{
      id: string;
      price: {
        id: string;
        unit_amount: number;
        currency: string;
        recurring: {
          interval: string;
        };
      };
    }>;
  } | null;
  usage: {
    editCount: number;
    monthlyEditCount: number;
    remainingEdits: number | null;
    remainingMonthlyEdits: number | null;
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
  const [showCancelDialog, setShowCancelDialog] = useState(false);
  const [isMonthly, setIsMonthly] = useState(true);

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
        annual: isMonthly,
        withTrial: false,
      });
      window.location.href = checkoutUrl;
    } catch (error) {
      console.error('Error creating checkout session:', error);
      toast.error('Failed to start checkout. Please try again.');
      setIsCheckoutLoading(false);
    }
  };

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

  const handleCancelDialogChange = (open: boolean) => {
    setShowCancelDialog(open);
    // Refresh subscription data when dialog closes
    if (!open) {
      fetchSubscriptionStatus();
    }
  };

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CreditCard className="h-5 w-5" />
            Subscription Status
          </CardTitle>
          <CardDescription>Loading subscription information...</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="animate-pulse space-y-2">
            <div className="h-4 w-3/4 rounded bg-neutral-200"></div>
            <div className="h-4 w-1/2 rounded bg-neutral-200"></div>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!subscriptionData) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CreditCard className="h-5 w-5" />
            Subscription Status
          </CardTitle>
          <CardDescription>
            Unable to load subscription information
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-neutral-600">Please try again later.</p>
        </CardContent>
      </Card>
    );
  }

  const { hasSubscription, subscription, usage } = subscriptionData;

  if (usage.hasUnlimitedEdits && !hasSubscription) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Zap className="h-5 w-5 text-blue-500" />
            Unlimited AI Edits
          </CardTitle>
          <CardDescription>
            Your account has been granted unlimited AI edit credits.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-neutral-700">Status</span>
            <Badge variant="secondary">Unlimited Access</Badge>
          </div>

          <div className="space-y-2 rounded-lg bg-neutral-50 p-4">
            <p className="text-sm text-neutral-600">
              You can continue using AI-powered edits without any usage limits.
            </p>
            <div className="text-xs text-neutral-500">
              Lifetime edits used:{' '}
              <span className="font-medium text-neutral-700">
                {usage.editCount}
              </span>
            </div>
            <div className="text-xs text-neutral-500">
              Monthly edits used:{' '}
              <span className="font-medium text-neutral-700">
                {usage.monthlyEditCount}
              </span>
            </div>
            {usage.monthlyResetDate && (
              <p className="text-xs text-neutral-500">
                Monthly usage resets on{' '}
                {new Date(usage.monthlyResetDate).toLocaleDateString()}
              </p>
            )}
          </div>
        </CardContent>
      </Card>
    );
  }

  if (hasSubscription && subscription) {
    const isActive = subscription.status === 'active';
    const isCancelling = subscription.cancel_at_period_end;
    const periodEnd = new Date(subscription.current_period_end * 1000);
    const periodStart = new Date(subscription.current_period_start * 1000);
    const hasUnlimitedAccess = usage.hasUnlimitedEdits;

    const price = subscription.items[0]?.price;
    const amount = price ? (price.unit_amount / 100).toFixed(2) : '0.00';
    const currency = price?.currency?.toUpperCase() || 'USD';
    const interval = price?.recurring?.interval || 'month';

    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CreditCard className="h-5 w-5" />
            Subscription Status
          </CardTitle>
          <CardDescription>
            Manage your subscription and billing
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-neutral-700">Status</span>
            <Badge variant={isActive ? 'default' : 'secondary'}>
              {isActive
                ? 'Active'
                : subscription.status.charAt(0).toUpperCase() +
                  subscription.status.slice(1).toLowerCase()}
            </Badge>
          </div>

          {isCancelling && (
            <div className="flex items-center gap-2 rounded-md bg-orange-50 p-3">
              <AlertCircle className="h-4 w-4 text-orange-500" />
              <span className="text-sm text-orange-700">
                Your subscription will end on {periodEnd.toLocaleDateString()}
              </span>
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-medium text-neutral-700">
                Current Plan
              </label>
              <p className="text-sm text-neutral-500">
                {amount} {currency}/{interval}
              </p>
            </div>
            <div>
              <label className="text-sm font-medium text-neutral-700">
                Billing Period
              </label>
              <p className="text-sm text-neutral-500">
                {periodStart.toLocaleDateString()} -{' '}
                {periodEnd.toLocaleDateString()}
              </p>
            </div>
          </div>

          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-neutral-700">
              AI Edits Used
            </span>
            <div className="flex items-center gap-2">
              <span className="text-sm text-neutral-500">
                {hasUnlimitedAccess
                  ? 'Unlimited edits enabled'
                  : subscription.status === 'active'
                    ? `${usage.monthlyEditCount}/50 monthly edits`
                    : `${usage.editCount} edits`}
              </span>
              {hasUnlimitedAccess ? (
                <Zap className="h-4 w-4 text-blue-500" />
              ) : (
                <CheckCircle className="h-4 w-4 text-green-500" />
              )}
            </div>
          </div>

          {subscription.status === 'active' &&
            (hasUnlimitedAccess ? (
              <div className="rounded-lg bg-blue-50 p-3">
                <p className="text-sm text-blue-700">
                  Unlimited AI edits have been granted to your account. We'll
                  still track usage, but no limits apply this billing cycle.
                </p>
                {usage.monthlyResetDate && (
                  <p className="mt-2 text-xs text-blue-600">
                    Tracking resets on{' '}
                    {new Date(usage.monthlyResetDate).toLocaleDateString()}
                  </p>
                )}
              </div>
            ) : (
              <div className="rounded-lg bg-blue-50 p-3">
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-sm font-medium text-blue-700">
                    Monthly Usage
                  </span>
                  <Badge variant="outline" className="text-xs">
                    {usage.remainingMonthlyEdits} remaining
                  </Badge>
                </div>
                <div className="h-2 w-full rounded-full bg-blue-200">
                  <div
                    className="h-2 rounded-full bg-blue-500 transition-all duration-300"
                    style={{ width: `${(usage.monthlyEditCount / 50) * 100}%` }}
                  />
                </div>
                {usage.monthlyResetDate && (
                  <p className="mt-2 text-xs text-blue-600">
                    Resets on{' '}
                    {new Date(usage.monthlyResetDate).toLocaleDateString()}
                  </p>
                )}
              </div>
            ))}

          <div className="flex gap-2">
            <Button
              size="sm"
              onClick={handleManageSubscription}
              disabled={isManageLoading}
            >
              {isManageLoading ? 'Loading...' : 'Manage Plan'}
            </Button>
            {isActive && !isCancelling && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowCancelDialog(true)}
              >
                Cancel Subscription
              </Button>
            )}
          </div>

          <CancelSubscriptionDialog
            open={showCancelDialog}
            onOpenChange={handleCancelDialogChange}
          />
        </CardContent>
      </Card>
    );
  }

  // No subscription - show usage and upgrade options
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <CreditCard className="h-5 w-5" />
          Subscription Status
        </CardTitle>
        <CardDescription>You don't have an active subscription</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Usage Summary */}
        <div className="rounded-lg bg-neutral-50 p-4">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-sm font-medium text-neutral-700">
              Your Usage
            </span>
            <Badge variant={usage.limitReached ? 'destructive' : 'secondary'}>
              {usage.editCount}/5 edits used
            </Badge>
          </div>
          <div className="h-2 w-full rounded-full bg-neutral-200">
            <div
              className="h-2 rounded-full bg-amber-500 transition-all duration-300"
              style={{ width: `${(usage.editCount / 5) * 100}%` }}
            />
          </div>
          <p className="mt-2 text-xs text-neutral-500">
            {usage.remainingEdits && usage.remainingEdits > 0
              ? `${usage.remainingEdits} edits remaining`
              : 'No edits remaining'}
          </p>
        </div>

        {/* Billing Toggle */}
        <div className="flex items-center gap-2">
          <Switch
            id="monthly-switch"
            checked={isMonthly}
            onCheckedChange={setIsMonthly}
          />
          <Label
            htmlFor="monthly-switch"
            className="cursor-pointer text-sm font-normal"
          >
            Save 50% with monthly billing
          </Label>
        </div>

        {/* Pricing */}
        <div className="space-y-1">
          <div className="flex items-baseline gap-2">
            <p className="text-3xl font-bold">{isMonthly ? '$2.49' : '$4.99'}</p>
            <p className="text-sm text-muted-foreground">per week</p>
          </div>
          {isMonthly && (
            <p className="text-xs text-muted-foreground">Billed monthly at $9.99/month</p>
          )}
          {!isMonthly && (
            <p className="text-xs text-muted-foreground">Billed weekly</p>
          )}
        </div>

        {/* Features */}
        <div>
          <p className="mb-4 text-sm font-semibold">Octree Pro includes</p>
          <FeatureList />
        </div>

        {/* Subscribe Button */}
        <form onSubmit={handleCheckout}>
          <Button
            type="submit"
            className="w-full"
            variant="gradient"
            disabled={isCheckoutLoading}
          >
            {isCheckoutLoading ? 'Loading...' : 'Subscribe Now'}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
