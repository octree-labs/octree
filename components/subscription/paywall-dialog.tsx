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
  EXPORT_SINGLE_PRICE,
  FREE_DAILY_EDIT_LIMIT,
  GENERATE_SINGLE_PRICE,
  PRO_FEATURES,
  PRO_MONTHLY_EDIT_LIMIT,
  PRO_PLANS,
} from '@/data/constants';
import type { ProFeature } from '@/lib/subscription/features';
import { CHECKOUT_OFFERS, offerAppliesToPlan } from '@/lib/checkout-offers';
import { firstPurchaseOfferCopy } from '@/lib/first-purchase-offer';
import { EXPORT_ALREADY_UNLOCKED_MESSAGE } from '@/lib/export-unlock';
import { PaywallActions, paywallOfferFor, usePaywall } from '@/stores/paywall';
import { ProjectActions } from '@/stores/project';

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
  ats: {
    title: 'Resume check is a Pro feature',
    description: 'See how hiring software reads your resume and match it to any job.',
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

/** Export with a project to unlock: sell Pro, or export for just this document. */
const EXPORT_SINGLE_COPY = {
  title: 'Export this document',
  description: 'Pay once for this document, or go Pro for every project.',
};

/** The one-off offer (first card) of the two-card layout, per feature. */
type SingleOffer = {
  heading: string;
  price: string;
  blurb: string;
  button: string;
  request: Parameters<typeof createCheckoutSession>[0];
};

/**
 * The in-product paywall. Opened from anywhere with `PaywallActions.open(feature)`
 * (see stores/paywall.ts); mounted once per layout that has gated features.
 *
 * With `offers` including `single` it shows two offers: Generate (reason
 * `generate_quota`) sells one more generation, and Export (with
 * `context.projectId`, from the editor toolbar) sells a $4.99 one-off unlock
 * of export for that project, forever. For Generate: The one-off $2.99 generation credit
 * comes first and carries the primary button: this paywall opens the moment a
 * new account spends its single free generation. On the first day of PostHog
 * data (18 Oct 2026), with Pro on top, all four such users dismissed it at
 * least once (eight dismissals) and only one came back to start a monthly
 * checkout. A $2.99 "finish this document" is the smaller ask; Pro stays one
 * tap below it.
 *
 * With a first-purchase offer (`firstPurchaseOffer` in the store, from GET
 * /api/subscription-status: a user who has never bought anything) the Pro
 * offer shows 50% off the first month and its button passes the offer to
 * checkout, monthly plan only. The one-off and credit offers are unchanged,
 * and without the offer the dialog renders exactly as it did before.
 */
export function PaywallDialog() {
  const { open, feature, reason, offers, firstPurchaseOffer, context } = usePaywall();
  const [plan, setPlan] = useState<PickerPlan>('monthly');
  const [isSubmitting, setIsSubmitting] = useState<'pro' | 'single' | null>(null);

  const creditsOnly = reason === 'monthly_limit';
  const exportProjectId = feature === 'export' ? context?.projectId : undefined;
  const singleOffer: SingleOffer | null = !offers.includes('single')
    ? null
    : feature === 'generate'
      ? {
          heading: 'Just this document',
          price: `${GENERATE_SINGLE_PRICE.price} once`,
          blurb: 'One more generation, no subscription.',
          button: `Generate this one — ${GENERATE_SINGLE_PRICE.price}`,
          request: { plan: 'generate_single', source: 'paywall' },
        }
      : exportProjectId
        ? {
            heading: 'Export this document',
            price: `${EXPORT_SINGLE_PRICE.price} once`,
            blurb: 'PDF and ZIP, no subscription.',
            button: 'Unlock export',
            request: { plan: 'export_single', projectId: exportProjectId, source: 'paywall' },
          }
        : null;
  const offersSingle = singleOffer !== null;
  const copy = creditsOnly
    ? MONTHLY_LIMIT_COPY
    : feature === 'generate' && reason === 'generate_quota'
      ? GENERATE_QUOTA_COPY
      : feature === 'export' && offersSingle
        ? EXPORT_SINGLE_COPY
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
      // Already unlocked (a second tab, a stale store): nothing to buy.
      if (
        request?.plan === 'export_single' &&
        request.projectId &&
        error instanceof Error &&
        error.message === EXPORT_ALREADY_UNLOCKED_MESSAGE
      ) {
        ProjectActions.setExportUnlocked(request.projectId, true);
        PaywallActions.close();
        setIsSubmitting(null);
        toast.success('Export is already unlocked for this document');
        return;
      }
      console.error('Failed to create checkout session:', error);
      toast.error('Failed to start checkout. Please try again.');
      setIsSubmitting(null);
    }
  };

  // Never on monthly_limit (credits only); the offer covers the monthly plan.
  const offer = paywallOfferFor(reason, firstPurchaseOffer);
  const offerCopy = offer ? firstPurchaseOfferCopy(offer) : null;
  const pickerOffer = offer && offerAppliesToPlan(offer, plan) ? offer : null;

  const handleSubscribe = () =>
    startCheckout('pro', {
      plan,
      withTrial: false,
      source: 'paywall',
      ...(pickerOffer ? { offer: pickerOffer } : {}),
    });

  if (singleOffer) {
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
                <p className="font-semibold">{singleOffer.heading}</p>
                <p className="text-sm text-muted-foreground">{singleOffer.price}</p>
              </div>
              <p className="mt-1 text-sm text-muted-foreground">{singleOffer.blurb}</p>
              <Button
                className="mt-3 w-full"
                variant="gradient"
                onClick={() => startCheckout('single', singleOffer.request)}
                disabled={isSubmitting !== null}
              >
                {isSubmitting === 'single' ? 'Loading...' : singleOffer.button}
              </Button>
            </div>

            <div className="rounded-lg border p-4">
              <div className="flex items-baseline justify-between gap-2">
                <p className="font-semibold">Octree Pro</p>
                <p className="text-sm text-muted-foreground">
                  {offerCopy ? offerCopy.priceLine : `${PRO_PLANS.monthly.price}/mo`}
                </p>
              </div>
              <p className="mt-1 text-sm text-muted-foreground">
                {PRO_MONTHLY_EDIT_LIMIT} AI edits a month, unlimited generations, export everywhere. Cancel anytime.
              </p>
              <Button
                className="mt-3 w-full"
                variant="outline"
                // The monthly plan it displays, whatever the picker state is.
                onClick={() =>
                  startCheckout('pro', {
                    plan: 'monthly',
                    withTrial: false,
                    source: 'paywall',
                    ...(offer ? { offer } : {}),
                  })
                }
                disabled={isSubmitting !== null}
              >
                {isSubmitting === 'pro'
                  ? 'Loading...'
                  : offerCopy
                    ? offerCopy.button
                    : `Go Pro for ${PRO_PLANS.monthly.price}/mo`}
              </Button>
            </div>

            <Button
              variant="link"
              size="sm"
              className="mx-auto flex h-auto p-0 text-muted-foreground hover:text-foreground"
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

        <div className="space-y-5">
          <PlanPicker
            plan={plan}
            onPlanChange={setPlan}
            source="paywall"
            creditsOnly={creditsOnly}
            // Credits buy AI edits only; on the other paywalls they are noise.
            hideCredits={!creditsOnly && feature !== 'ai-edit'}
            disabled={isSubmitting !== null}
            {...(pickerOffer ? { offerPercentOff: CHECKOUT_OFFERS[pickerOffer].percentOff } : {})}
          />

          {!creditsOnly && (
            <ul className="space-y-1.5">
              {PRO_FEATURES.map((text) => (
                <li key={text} className="flex gap-2.5 text-sm text-muted-foreground">
                  <Check className="mt-0.5 size-4 shrink-0 text-primary" />
                  <span>{text}</span>
                </li>
              ))}
            </ul>
          )}

          <div className="space-y-2">
            {!creditsOnly && (
              <Button
                className="w-full"
                variant="gradient"
                onClick={handleSubscribe}
                disabled={isSubmitting !== null}
              >
                {isSubmitting === 'pro'
                  ? 'Loading...'
                  : pickerOffer && offerCopy
                    ? offerCopy.button
                    : 'Get Octree Pro'}
              </Button>
            )}
            <Button
              variant="link"
              size="sm"
              className="mx-auto flex h-auto p-0 text-muted-foreground hover:text-foreground"
              onClick={PaywallActions.close}
              disabled={isSubmitting !== null}
            >
              Not now
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
