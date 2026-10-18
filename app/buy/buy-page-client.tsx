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

interface BuyPageClientProps {
  /** Checkout starts at once when set; otherwise the picker is shown. */
  plan: CheckoutPlanRequest | null;
}

export function BuyPageClient({ plan: requestedPlan }: BuyPageClientProps) {
  const router = useRouter();
  const [plan, setPlan] = useState<PickerPlan>('monthly');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const startCheckout = async (selected: CheckoutPlanRequest) => {
    setIsSubmitting(true);
    try {
      const checkoutUrl = await createCheckoutSession({ plan: selected, source: 'buy' });
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

          <PlanPicker plan={plan} onPlanChange={setPlan} source="buy" disabled={isSubmitting} />

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
