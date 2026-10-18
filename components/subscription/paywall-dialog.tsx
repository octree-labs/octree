'use client';

import { useState } from 'react';
import { Check } from 'lucide-react';
import { toast } from 'sonner';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { createCheckoutSession } from '@/lib/requests/subscription';
import { FREE_DAILY_EDIT_LIMIT, PRO_FEATURES, PRO_MONTHLY_EDIT_LIMIT, PRO_PLANS } from '@/data/constants';
import type { ProFeature } from '@/lib/subscription/features';
import { PaywallActions, usePaywall } from '@/stores/paywall';

const COPY: Record<ProFeature, { title: string; description: string }> = {
  'ai-edit': {
    title: "You've used today's free AI edits",
    description: `The free plan includes ${FREE_DAILY_EDIT_LIMIT} AI edits a day. Pro gives you ${PRO_MONTHLY_EDIT_LIMIT} a month.`,
  },
  export: {
    title: 'Export is a Pro feature',
    description: 'Upgrade to download your project as a PDF or a ZIP of all files.',
  },
  generate: {
    title: 'Generate is a Pro feature',
    description: 'Upgrade to generate complete documents from a prompt.',
  },
};

/**
 * The in-product paywall. Opened from anywhere with `PaywallActions.open(feature)`
 * (see stores/paywall.ts); mounted once per layout that has gated features.
 */
export function PaywallDialog() {
  const { open, feature } = usePaywall();
  const [isMonthly, setIsMonthly] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const copy = COPY[feature ?? 'ai-edit'];
  const plan = isMonthly ? PRO_PLANS.monthly : PRO_PLANS.weekly;

  const handleSubscribe = async () => {
    setIsSubmitting(true);
    try {
      const checkoutUrl = await createCheckoutSession({
        annual: isMonthly,
        withTrial: false,
      });
      window.location.href = checkoutUrl;
    } catch (error) {
      console.error('Failed to create checkout session:', error);
      toast.error('Failed to start checkout. Please try again.');
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && PaywallActions.close()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{copy.title}</DialogTitle>
          <DialogDescription>{copy.description}</DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          <div className="space-y-1">
            <div className="flex items-baseline gap-2">
              <p className="text-3xl font-bold">
                {isMonthly ? PRO_PLANS.monthly.weeklyEquivalent : PRO_PLANS.weekly.price}
              </p>
              <p className="text-sm text-muted-foreground">per week</p>
              {isMonthly && (
                <p className="text-sm text-muted-foreground line-through">
                  {PRO_PLANS.weekly.price}
                </p>
              )}
            </div>
            <p className="text-xs text-muted-foreground">{plan.billingNote}</p>
          </div>

          <div className="flex items-center gap-2">
            <Switch
              id="paywall-monthly-switch"
              checked={isMonthly}
              onCheckedChange={setIsMonthly}
            />
            <Label
              htmlFor="paywall-monthly-switch"
              className="cursor-pointer text-sm font-normal"
            >
              {isMonthly ? 'Monthly billing enabled' : 'Switch to monthly and save 50%'}
            </Label>
          </div>

          <div>
            <p className="mb-3 text-sm font-semibold">What you get with Pro</p>
            <ul className="space-y-2">
              {PRO_FEATURES.map((text) => (
                <li key={text} className="flex gap-3 text-sm leading-5 text-muted-foreground">
                  <Check className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>{text}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="flex gap-2">
            <Button
              variant="outline"
              className="flex-1"
              onClick={PaywallActions.close}
              disabled={isSubmitting}
            >
              Not now
            </Button>
            <Button
              className="flex-1"
              variant="gradient"
              onClick={handleSubscribe}
              disabled={isSubmitting}
            >
              {isSubmitting ? 'Loading...' : 'Get Octree Pro →'}
            </Button>
          </div>

          <p className="text-center text-xs text-muted-foreground">
            Cancel anytime. No questions asked.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
