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
  GENERATE_SINGLE_PRICE,
  PRO_FEATURES,
  PRO_MONTHLY_EDIT_LIMIT,
  PRO_PLANS,
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

/** The free generation is spent: sell Pro, or just this one document. */
const GENERATE_QUOTA_COPY = {
  title: "You've used your free generation",
  description:
    'Every account gets one free document. Go Pro for unlimited generations, or buy just this one.',
};

/**
 * The in-product paywall. Opened from anywhere with `PaywallActions.open(feature)`
 * (see stores/paywall.ts); mounted once per layout that has gated features.
 *
 * With `offers` including `single` (only Generate does this, with reason
 * `generate_quota`) it shows two offers. The one-off $2.99 generation credit
 * comes first and carries the primary button: this paywall opens the moment a
 * new account spends its single free generation. On the first day of PostHog
 * data (18 Oct 2026), with Pro on top, all four such users dismissed it at
 * least once (eight dismissals) and only one came back to start a monthly
 * checkout. A $2.99 "finish this document" is the smaller ask; Pro stays one
 * tap below it.
 */
export function PaywallDialog() {
  const { open, feature, reason, offers } = usePaywall();
  const [plan, setPlan] = useState<PickerPlan>('monthly');
  const [isSubmitting, setIsSubmitting] = useState<'pro' | 'single' | null>(null);

  const creditsOnly = reason === 'monthly_limit';
  const offersSingle = feature === 'generate' && offers.includes('single');
  const copy = creditsOnly
    ? MONTHLY_LIMIT_COPY
    : feature === 'generate' && reason === 'generate_quota'
      ? GENERATE_QUOTA_COPY
      : COPY[feature ?? 'ai-edit'];

  const startCheckout = async (
    kind: 'pro' | 'single',
    request: Parameters<typeof createCheckoutSession>[0]
  ) => {
    setIsSubmitting(kind);
    try {
      const checkoutUrl = await createCheckoutSession(request);
      window.location.href = checkoutUrl;
    } catch (error) {
      console.error('Failed to create checkout session:', error);
      toast.error('Failed to start checkout. Please try again.');
      setIsSubmitting(null);
    }
  };

  const handleSubscribe = () => startCheckout('pro', { plan, withTrial: false, source: 'paywall' });

  if (offersSingle) {
    return (
      <Dialog open={open} onOpenChange={(next) => !next && PaywallActions.close()}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{copy.title}</DialogTitle>
            <DialogDescription>{copy.description}</DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="rounded-lg border p-4">
              <div className="flex items-baseline justify-between gap-2">
                <p className="font-semibold">Just this document</p>
                <p className="text-sm text-muted-foreground">{GENERATE_SINGLE_PRICE.price} once</p>
              </div>
              <p className="mt-1 text-sm text-muted-foreground">One more generation, no subscription.</p>
              <Button
                className="mt-3 w-full"
                variant="gradient"
                onClick={() => startCheckout('single', { plan: 'generate_single', source: 'paywall' })}
                disabled={isSubmitting !== null}
              >
                {isSubmitting === 'single'
                  ? 'Loading...'
                  : `Generate this one — ${GENERATE_SINGLE_PRICE.price}`}
              </Button>
            </div>

            <div className="rounded-lg border p-4">
              <div className="flex items-baseline justify-between gap-2">
                <p className="font-semibold">Octree Pro</p>
                <p className="text-sm text-muted-foreground">{PRO_PLANS.monthly.price}/mo</p>
              </div>
              <p className="mt-1 text-sm text-muted-foreground">
                {PRO_MONTHLY_EDIT_LIMIT} AI edits a month, unlimited generations, PDF and ZIP export.
              </p>
              <Button
                className="mt-3 w-full"
                variant="outline"
                // The monthly plan it displays, whatever the picker state is.
                onClick={() => startCheckout('pro', { plan: 'monthly', withTrial: false, source: 'paywall' })}
                disabled={isSubmitting !== null}
              >
                {isSubmitting === 'pro' ? 'Loading...' : `Go Pro — ${PRO_PLANS.monthly.price}/mo`}
              </Button>
              <p className="mt-2 text-center text-xs text-muted-foreground">
                {PRO_PLANS.monthly.billingNote}
              </p>
            </div>

            <Button
              variant="ghost"
              className="w-full"
              onClick={PaywallActions.close}
              disabled={isSubmitting !== null}
            >
              Not now
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

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
            disabled={isSubmitting !== null}
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
              disabled={isSubmitting !== null}
            >
              Not now
            </Button>
            {!creditsOnly && (
              <Button
                className="flex-1"
                variant="gradient"
                onClick={handleSubscribe}
                disabled={isSubmitting !== null}
              >
                {isSubmitting === 'pro' ? 'Loading...' : 'Get Octree Pro →'}
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
