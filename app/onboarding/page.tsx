'use client';

import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Check } from 'lucide-react';

import { createClient } from '@/lib/supabase/client';
import { resetAnalytics } from '@/lib/analytics/track';
import { Button } from '@/components/ui/button';
// Card imports removed — using plain layout instead
// import {
//   Card,
//   CardContent,
//   CardDescription,
//   CardHeader,
//   CardTitle,
// } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

import { ProgressDots } from './components/progress-dots';
import {
  REFERRAL_OPTIONS,
  ROLE_OPTIONS,
  USE_CASE_OPTIONS,
  TOTAL_STEPS,
  PLAN_STEP,
  START_STEP,
} from './constants';
import { OctreeLogo, OctreeWordmark } from '@/components/icons/octree-logo';
import { ONBOARDING_PAYWALL_REQUIRED, PRO_MONTHLY_EDIT_LIMIT } from '@/data/constants';
import { PlanPicker, type PickerPlan } from '@/components/subscription/plan-picker';
import { createCheckoutSession } from '@/lib/requests/subscription';
import { getUserUsageStatus, upsertUserUsage } from '@/lib/requests/user';
import { Skeleton } from '@/components/ui/skeleton';
import { completeFreeOnboarding } from '@/lib/requests/onboarding';
import { AuthMarketingSection } from '@/components/auth/auth-marketing-section';
import { StartWithDocument } from '@/components/onboarding/start-with-document';
import { hasFinishedOnboarding, onboardingPaywallApplies, safeNextPath } from '@/lib/onboarding/paywall-gate';
import { PlanStepActions } from './components/plan-step-actions';
import { OfferV2Plans } from '@/components/subscription/offer-v2-plans';
import { useCountdown, useOffer } from '@/hooks/use-offer';
import { useRegionalPricing } from '@/hooks/use-regional-pricing';
import { CHECKOUT_OFFERS, discountedAmount } from '@/lib/checkout-offers';
import {
  OFFER_HEADLINE,
  OFFER_SUBHEADLINE,
  offerPlanCopy,
  type OfferPlan,
} from '@/lib/offer-v2/offer';
import { AnalyticsEvents } from '@/lib/analytics/events';
import { track } from '@/lib/analytics/track';

// What Pro adds over the free plan, kept to three lines (see app/onboarding/components/feature-list.tsx for the full list).
const PRO_HIGHLIGHTS = [
  'AI writes and edits your LaTeX from a prompt',
  'Catches errors and suggests one-click fixes',
  'Finds and inserts citations from your references',
];

// Under the onboarding paywall Pro is the only way in, so say what it costs
// you not to have it: the limits and the export.
const PAYWALL_HIGHLIGHTS = [
  ...PRO_HIGHLIGHTS,
  `${PRO_MONTHLY_EDIT_LIMIT} AI edits a month, plus PDF and ZIP export`,
];

export default function OnboardingPage() {
  const [currentStep, setCurrentStep] = useState(0);
  const [referralSource, setReferralSource] = useState<string>('');
  const [role, setRole] = useState<string>('');
  const [useCase, setUseCase] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [userEmail, setUserEmail] = useState<string>('');
  const [plan, setPlan] = useState<PickerPlan>('monthly');
  // The page to continue to after checkout: the project a tools.useoctree.com
  // draft was imported into, or /generate (lib/onboarding/paywall-gate-server.ts).
  const [nextPath, setNextPath] = useState<string | undefined>();
  // Whether this account is under the onboarding paywall (the switch, and
  // not older than ONBOARDING_PAYWALL_SINCE); settled once the user loads.
  const [paywallRequired, setPaywallRequired] = useState(ONBOARDING_PAYWALL_REQUIRED);
  const router = useRouter();
  // `onboarding-offer-v2` (GET /api/offer): which plan step this user sees.
  const offer = useOffer();
  const isOfferV2 = offer?.variant === 'offer_v2';
  const pricing = useRegionalPricing();
  const deadline = isOfferV2 ? offer?.deadline ?? null : null;
  const deadlineMsLeft = useCountdown(deadline?.endsAt);
  // The first-purchase offer applies only while its real deadline runs.
  const deadlineOffer = deadline && deadlineMsLeft !== null && deadlineMsLeft > 0 ? deadline.offer : null;
  const [v2Plan, setV2Plan] = useState<OfferPlan | null>(null);
  const [passRevealed, setPassRevealed] = useState(false);
  // Annual first; while the sign-up offer runs, its plan (monthly) is preselected.
  const selectedV2Plan: OfferPlan = v2Plan ?? (deadlineOffer ? 'monthly' : 'annual');
  const v2Plans = useMemo(() => {
    const percentOff = deadlineOffer ? CHECKOUT_OFFERS[deadlineOffer].percentOff : 0;
    const firstMonth = deadlineOffer
      ? { price: `$${discountedAmount(pricing.proPlans.monthly.amount, percentOff).toFixed(2)}`, percentOff }
      : null;
    return offerPlanCopy(pricing, firstMonth);
  }, [pricing, deadlineOffer]);
  // With the paywall on the "Start with your document" step is never reached
  // (it followed the free path); paid users land on the dashboard's empty
  // state, which offers the same options.
  const visibleSteps = paywallRequired ? PLAN_STEP + 1 : TOTAL_STEPS;

  useEffect(() => {
    const checkUserStatus = async () => {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();

      const next = safeNextPath(new URLSearchParams(window.location.search).get('next'));
      setNextPath(next);

      const applies = onboardingPaywallApplies(user?.created_at);
      setPaywallRequired(applies);

      if (user?.email) {
        setUserEmail(user.email);

        // Already onboarded (free or Pro): on to where they were going
        const usageData = await getUserUsageStatus(user.id);

        if (hasFinishedOnboarding(usageData, applies)) {
          router.push(next ?? '/');
          return;
        }

        // Back from Stripe (or a reload): the profile step was already answered,
        // so go straight to the plans instead of asking again.
        const { data: profile } = await supabase
          .from('user_usage')
          .select('role, use_case, referral_source')
          .eq('user_id', user.id)
          .maybeSingle<{ role: string | null; use_case: string | null; referral_source: string | null }>();
        if (profile?.role && profile.use_case && profile.referral_source) {
          setRole(profile.role);
          setUseCase(profile.use_case);
          setReferralSource(profile.referral_source);
          setCurrentStep((step) => (step === 0 ? PLAN_STEP : step));
        }
      }
    };
    checkUserStatus();
  }, [router]);

  const handleLogout = async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    resetAnalytics();
    router.push('/auth/login');
  };

  const handleNext = async () => {
    if (currentStep === 0) {
      if (!role) {
        toast.error('Please select your role');
        return;
      }
      if (!useCase) {
        toast.error('Please select your primary use case');
        return;
      }
      if (!referralSource) {
        toast.error('Please select how you found Octree');
        return;
      }

      // Save onboarding data but don't mark as completed yet
      setIsSubmitting(true);
      try {
        const supabase = createClient();
        const {
          data: { user },
          error: userError,
        } = await supabase.auth.getUser();

        if (userError || !user) {
          toast.error('Session expired. Please log in again.');
          router.push('/auth/login');
          return;
        }

        await upsertUserUsage(user.id, {
          referral_source: referralSource,
          role,
          use_case: useCase,
          onboarding_completed: false,
        });

        setIsSubmitting(false);
        setCurrentStep(currentStep + 1);
      } catch (error) {
        console.error('Failed to save onboarding data:', error);
        toast.error('Failed to save your information. Please try again.');
        setIsSubmitting(false);
      }
      return;
    }

    // Special handling for step 1 (subscription step)
    if (currentStep === PLAN_STEP) {
      setIsSubmitting(true);
      try {
        const checkoutPlan = isOfferV2 ? selectedV2Plan : plan;
        const checkoutUrl = await createCheckoutSession({
          plan: checkoutPlan,
          withTrial: false,
          source: 'onboarding',
          ...(isOfferV2 && deadlineOffer && checkoutPlan === 'monthly' ? { offer: deadlineOffer } : {}),
          ...(paywallRequired ? { onboardingPaywall: true } : {}),
          ...(nextPath ? { successPath: nextPath } : {}),
        });
        // The user has only clicked through to Stripe here; `Purchase` is sent
        // server-side from the Stripe webhook once the session is actually paid.
        const conversionId = crypto.randomUUID();
        window.rdt?.('track', 'AddToCart', { conversionId });
        navigator.sendBeacon(
          '/api/reddit-capi',
          new Blob(
            [JSON.stringify({ eventName: 'AddToCart', conversionId, email: userEmail })],
            { type: 'application/json' },
          ),
        );
        window.location.href = checkoutUrl;
        return;
      } catch (error) {
        console.error('Failed to create checkout session:', error);
        toast.error('Failed to start checkout. Please try again.');
        setIsSubmitting(false);
        return;
      }
    }

    if (currentStep < TOTAL_STEPS - 1) {
      setCurrentStep(currentStep + 1);
    }
  };

  // Continue on the free plan (offered only with the onboarding paywall off):
  // marks onboarding complete (same flag the Stripe webhook sets for paying
  // users), then shows the "Start with your document"
  // step. The flag is written first, so a refresh on that step lands on the
  // dashboard (whose empty state offers the same options) instead of looping
  // back here. Pro features are gated inside the product instead.
  const handleContinueFree = async () => {
    setIsSubmitting(true);
    try {
      const supabase = createClient();
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();

      if (userError || !user) {
        toast.error('Session expired. Please log in again.');
        router.push('/auth/login');
        return;
      }

      await completeFreeOnboarding(user, { referralSource });
      setIsSubmitting(false);
      setCurrentStep(START_STEP);
    } catch (error) {
      console.error('Failed to continue on the free plan:', error);
      toast.error('Something went wrong. Please try again.');
      setIsSubmitting(false);
    }
  };

  const handleBack = () => {
    if (currentStep > 0) {
      setCurrentStep(currentStep - 1);
    }
  };

  const renderStep = () => {
    switch (currentStep) {
      case 0:
        return (
          <>
            <div className="space-y-1.5">
              <h2 className="text-2xl font-semibold leading-none tracking-tight">Welcome to Octree!</h2>
              <p className="text-sm text-muted-foreground">
                Let's start by learning a bit about you.
              </p>
            </div>
            <div className="space-y-6 pt-4">
              <div className="space-y-2">
                <Label htmlFor="role">Your role</Label>
                <Select value={role} onValueChange={setRole}>
                  <SelectTrigger id="role">
                    <SelectValue placeholder="Select an option" />
                  </SelectTrigger>
                  <SelectContent className="max-h-[300px]">
                    {ROLE_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="use-case">Primary use case</Label>
                <Select value={useCase} onValueChange={setUseCase}>
                  <SelectTrigger id="use-case">
                    <SelectValue placeholder="Select an option" />
                  </SelectTrigger>
                  <SelectContent className="max-h-[300px]">
                    {USE_CASE_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="referral-source">How did you find us?</Label>
                <Select
                  value={referralSource}
                  onValueChange={setReferralSource}
                >
                  <SelectTrigger id="referral-source">
                    <SelectValue placeholder="Select an option" />
                  </SelectTrigger>
                  <SelectContent className="max-h-[300px]">
                    {REFERRAL_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </>
        );

      case 1:
        if (offer === undefined) {
          // GET /api/offer decides which plan step to show; it answers fast
          // (control on any failure), so a short skeleton beats a flash of
          // the wrong variant.
          return (
            <div className="space-y-3">
              <Skeleton className="h-7 w-3/4" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-48 w-full" />
            </div>
          );
        }
        if (isOfferV2) {
          return (
            <>
              <div className="space-y-1.5">
                <h2 className="text-2xl font-semibold leading-tight tracking-tight">{OFFER_HEADLINE}</h2>
                <p className="text-sm text-muted-foreground">{OFFER_SUBHEADLINE}</p>
              </div>
              <div className="mt-4">
                <OfferV2Plans
                  plans={v2Plans}
                  plan={selectedV2Plan}
                  onPlanChange={setV2Plan}
                  deadlineMsLeft={deadlineOffer ? deadlineMsLeft : null}
                  deadlineLabel={deadlineOffer ? CHECKOUT_OFFERS[deadlineOffer].label : undefined}
                  proofCount={offer.proof?.count ?? null}
                  passRevealed={passRevealed || selectedV2Plan === 'deadline_pass'}
                  onRevealPass={() => {
                    setPassRevealed(true);
                    setV2Plan('deadline_pass');
                    track(AnalyticsEvents.PAYWALL_DOWNSELL_SHOWN, {
                      placement: 'onboarding',
                      offers: ['pass'],
                      offer_variant: 'offer_v2',
                      feature: 'onboarding',
                    });
                  }}
                  disabled={isSubmitting}
                />
              </div>
            </>
          );
        }
        return (
          <>
            <div className="space-y-1.5">
              <h2 className="text-2xl font-semibold leading-none tracking-tight">Write better papers, faster</h2>
              <p className="text-sm text-muted-foreground">
                {paywallRequired
                  ? 'Pick a plan to start writing with Octree Pro.'
                  : 'Stop wrestling with LaTeX. Let AI handle the formatting.'}
              </p>
            </div>
            <div className="relative mt-4 space-y-4 rounded-lg border border-border bg-blue-50/50 p-4">
              <PlanPicker
                plan={plan}
                onPlanChange={setPlan}
                source="onboarding"
                hideCredits
                disabled={isSubmitting}
              />

              {/* Short on purpose: the buttons below must stay in view. */}
              <ul className="space-y-2">
                {(paywallRequired ? PAYWALL_HIGHLIGHTS : PRO_HIGHLIGHTS).map((text) => (
                  <li key={text} className="flex gap-2 text-sm text-muted-foreground">
                    <Check className="mt-0.5 size-4 shrink-0 text-primary" />
                    {text}
                  </li>
                ))}
              </ul>
            </div>
          </>
        );

      case START_STEP:
        return (
          <>
            <div className="space-y-1.5">
              <h2 className="text-2xl font-semibold leading-none tracking-tight">
                Start with your document
              </h2>
              <p className="text-sm text-muted-foreground">
                Bring the LaTeX you are already working on. It opens in the editor and compiles
                right away.
              </p>
            </div>
            <StartWithDocument
              context="onboarding"
              onSkip={() => router.push('/')}
              className="pt-2"
            />
          </>
        );

      default:
        return null;
    }
  };

  const isStepValid = () => {
    if (currentStep === 0) return !!role && !!useCase && !!referralSource;
    if (currentStep === PLAN_STEP) return true; // Subscription step is always valid
    return false;
  };

  return (
    <div className="flex min-h-screen w-full">
      {/* Left side - Onboarding form */}
      <div className="flex w-full flex-col p-6 lg:w-1/2">
        {/* Logo and name at top */}
        <div className="mb-8 flex items-center gap-2">
          <OctreeLogo className="h-6 w-6" />
          <OctreeWordmark className="text-lg" />
        </div>

        {/* Center the form */}
        <div className="flex flex-1 items-center justify-center">
          <div className="w-full max-w-md space-y-6">
            <div className="space-y-6">
              {renderStep()}
              {/* The start step's cards are their own actions; no footer button. */}
              {currentStep === PLAN_STEP && (
                <PlanStepActions
                  offerVariant={offer?.variant ?? null}
                  ctaLabel={isOfferV2 ? `${v2Plans[selectedV2Plan].cta} →` : undefined}
                  paywallRequired={paywallRequired}
                  isSubmitting={isSubmitting}
                  onCheckout={handleNext}
                  onContinueFree={handleContinueFree}
                  onSignOut={handleLogout}
                />
              )}
              {currentStep !== START_STEP && currentStep !== PLAN_STEP && (
                <Button
                  className="w-full"
                  variant="gradient"
                  onClick={handleNext}
                  disabled={isSubmitting || !isStepValid()}
                >
                  {isSubmitting ? 'Saving...' : 'Continue'}
                </Button>
              )}
            </div>

            {/* Progress dots with back button and user info below card */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <ProgressDots
                  currentStep={currentStep}
                  totalSteps={visibleSteps}
                />
                {currentStep > 0 && currentStep !== START_STEP && (
                  <Button
                    variant="link"
                    onClick={handleBack}
                    disabled={isSubmitting}
                    className="h-auto p-0 text-xs text-muted-foreground hover:text-foreground"
                  >
                    Back
                  </Button>
                )}
              </div>
              <div className="flex items-center gap-3">
                {userEmail ? (
                  <>
                    <span className="text-xs text-muted-foreground">
                      {userEmail}
                    </span>
                    <Button
                      variant="link"
                      onClick={handleLogout}
                      className="h-auto p-0 text-xs"
                    >
                      Logout
                    </Button>
                  </>
                ) : (
                  // Same height as the email line, so the row doesn't shift when it loads.
                  <Skeleton className="h-4 w-48" />
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      <AuthMarketingSection />
    </div>
  );
}
