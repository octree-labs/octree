'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { PlanPicker, type PickerPlan } from '@/components/subscription/plan-picker';
import { FeatureList } from '@/app/onboarding/components/feature-list';
import { OctreeLogo, OctreeWordmark } from '@/components/icons/octree-logo';
import { createCheckoutSession, type CheckoutPlanRequest } from '@/lib/requests/subscription';
import { CHECKOUT_OFFERS, offerAppliesToPlan, type CheckoutOfferId } from '@/lib/checkout-offers';
import { AnalyticsEvents } from '@/lib/analytics/events';
import { track } from '@/lib/analytics/track';

interface BuyPageClientProps {
  /** Checkout starts at once when set; otherwise the picker is shown. */
  plan: CheckoutPlanRequest | null;
  /** A validated `?offer=` (lib/checkout-offers.ts); null without one. */
  offer?: CheckoutOfferId | null;
  /**
   * The first-purchase offer the server found the user eligible for
   * (app/buy/page.tsx); used only when the URL named no offer.
   */
  autoOffer?: CheckoutOfferId | null;
}

export function BuyPageClient({ plan: requestedPlan, offer: urlOffer = null, autoOffer = null }: BuyPageClientProps) {
  // An explicit ?offer= wins; otherwise the auto offer, exactly as if the
  // link had carried it.
  const offer = urlOffer ?? autoOffer;
  const isAutoOffer = !urlOffer && !!autoOffer;
  const router = useRouter();
  const [plan, setPlan] = useState<PickerPlan>('monthly');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const startCheckout = async (selected: CheckoutPlanRequest) => {
    setIsSubmitting(true);
    try {
      const checkoutUrl = await createCheckoutSession({
        plan: selected,
        source: 'buy',
        ...(offer && offerAppliesToPlan(offer, selected) ? { offer } : {}),
      });
      window.location.href = checkoutUrl;
    } catch (error) {
      console.error('Checkout error:', error);
      if (requestedPlan) {
        router.push('/settings?error=checkout_failed');
      } else {
        toast.error('Failed to start checkout. Please try again.');
        setIsSubmitting(false);
      }
    }
  };

  useEffect(() => {
    if (requestedPlan) {
      startCheckout(requestedPlan);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestedPlan]);

  const offerDetails = offer ? CHECKOUT_OFFERS[offer] : null;
  const showOfferBanner = !!offer && !requestedPlan;
  // The offer covers some plans only (welcome50: monthly); the banner says
  // so, and the price is shown discounted only for a plan it covers.
  const offerCoversPlan = !!offer && offerAppliesToPlan(offer, plan);
  useEffect(() => {
    if (showOfferBanner && offer) {
      track(AnalyticsEvents.OFFER_BANNER_SHOWN, isAutoOffer ? { offer, auto: true } : { offer });
    }
  }, [showOfferBanner, offer, isAutoOffer]);

  if (requestedPlan) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="flex items-center gap-2">
          <Loader2 className="h-6 w-6 animate-spin" />
          <p className="text-muted-foreground">Redirecting to checkout...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen w-full flex-col p-6">
      <div className="mb-8 flex items-center gap-2">
        <OctreeLogo className="h-6 w-6" />
        <OctreeWordmark className="text-lg" />
      </div>
      <div className="flex flex-1 items-center justify-center">
        <div className="w-full max-w-md space-y-6">
          <div className="space-y-1.5">
            <h1 className="text-2xl font-semibold leading-none tracking-tight">Get Octree Pro</h1>
            <p className="text-sm text-muted-foreground">
              Pick a plan. Cancel anytime, no questions asked.
            </p>
          </div>

          {showOfferBanner && offerDetails && (
            <div
              role="status"
              className="rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 text-sm text-foreground"
            >
              {offerCoversPlan ? (
                <>
                  {offerDetails.label} is applied at checkout (code{' '}
                  <span className="font-semibold">{offerDetails.promotionCode}</span>).
                </>
              ) : (
                <>
                  {offerDetails.label} (code{' '}
                  <span className="font-semibold">{offerDetails.promotionCode}</span>) applies to the
                  Monthly plan only. This plan is charged at its full price.
                </>
              )}
            </div>
          )}

          <PlanPicker
            plan={plan}
            onPlanChange={setPlan}
            source="buy"
            disabled={isSubmitting}
            {...(showOfferBanner && offerDetails && offerCoversPlan ? { offerPercentOff: offerDetails.percentOff } : {})}
          />

          <div>
            <p className="mb-4 text-sm font-semibold">What you get with Pro</p>
            <FeatureList />
          </div>

          <Button
            className="w-full"
            variant="gradient"
            onClick={() => startCheckout(plan)}
            disabled={isSubmitting}
          >
            {isSubmitting ? 'Loading...' : 'Get Octree Pro →'}
          </Button>
        </div>
      </div>
    </div>
  );
}
