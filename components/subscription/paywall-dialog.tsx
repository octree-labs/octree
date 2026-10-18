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
import { PlanPicker, type PickerPlan } from '@/components/subscription/plan-picker';
import { createCheckoutSession } from '@/lib/requests/subscription';
import {
  CREDIT_PACKS,
  FREE_DAILY_EDIT_LIMIT,
  PRO_FEATURES,
  PRO_MONTHLY_EDIT_LIMIT,
} from '@/data/constants';
import type { ProFeature } from '@/lib/subscription/features';
import { PaywallActions, usePaywall } from '@/stores/paywall';

const COPY: Record<ProFeature, { title: string; description: string }> = {
  'ai-edit': {
    title: "You've used today's free AI edits",
    description: `The free plan includes ${FREE_DAILY_EDIT_LIMIT} AI edits a day. Pro gives you ${PRO_MONTHLY_EDIT_LIMIT} a month, or buy ${CREDIT_PACKS.credits_100.credits} edits for ${CREDIT_PACKS.credits_100.price} that never expire.`,
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

/** A Pro subscriber out of monthly edits: upgrading cannot help, credits can. */
const MONTHLY_LIMIT_COPY = {
  title: "You've used this month's AI edits",
  description: `Pro includes ${PRO_MONTHLY_EDIT_LIMIT} AI edits a month. Buy ${CREDIT_PACKS.credits_100.credits} more for ${CREDIT_PACKS.credits_100.price} (credits never expire) or wait for your monthly reset.`,
};

/**
 * The in-product paywall. Opened from anywhere with `PaywallActions.open(feature)`
 * (see stores/paywall.ts); mounted once per layout that has gated features.
 */
export function PaywallDialog() {
  const { open, feature, reason } = usePaywall();
  const [plan, setPlan] = useState<PickerPlan>('monthly');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const creditsOnly = reason === 'monthly_limit';
  const copy = creditsOnly ? MONTHLY_LIMIT_COPY : COPY[feature ?? 'ai-edit'];

  const handleSubscribe = async () => {
    setIsSubmitting(true);
    try {
      const checkoutUrl = await createCheckoutSession({
        plan,
        withTrial: false,
        source: 'paywall',
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
          <PlanPicker
            plan={plan}
            onPlanChange={setPlan}
            source="paywall"
            creditsOnly={creditsOnly}
            disabled={isSubmitting}
          />

          {!creditsOnly && (
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
          )}

          <div className="flex gap-2">
            <Button
              variant="outline"
              className="flex-1"
              onClick={PaywallActions.close}
              disabled={isSubmitting}
            >
              Not now
            </Button>
            {!creditsOnly && (
              <Button
                className="flex-1"
                variant="gradient"
                onClick={handleSubscribe}
                disabled={isSubmitting}
              >
                {isSubmitting ? 'Loading...' : 'Get Octree Pro →'}
              </Button>
            )}
          </div>

          {!creditsOnly && (
            <p className="text-center text-xs text-muted-foreground">
              Cancel anytime. No questions asked.
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
