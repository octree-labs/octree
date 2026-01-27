'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';

import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';

import { ProgressDots } from './components/progress-dots';
import { FeatureList } from './components/feature-list';
import {
  REFERRAL_OPTIONS,
  ROLE_OPTIONS,
  USE_CASE_OPTIONS,
  TOTAL_STEPS,
} from './constants';
import { OctreeLogo } from '@/components/icons/octree-logo';
import { createCheckoutSession } from '@/lib/requests/subscription';
import { getUserUsageStatus, upsertUserUsage } from '@/lib/requests/user';
import { AuthMarketingSection } from '@/components/auth/auth-marketing-section';

export default function OnboardingPage() {
  const [currentStep, setCurrentStep] = useState(0);
  const [referralSource, setReferralSource] = useState<string>('');
  const [role, setRole] = useState<string>('');
  const [useCase, setUseCase] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [userEmail, setUserEmail] = useState<string>('');
  const [isMonthly, setIsMonthly] = useState(true);
  const router = useRouter();

  useEffect(() => {
    const checkUserStatus = async () => {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (user?.email) {
        setUserEmail(user.email);

        // Check if user is already pro or has completed onboarding
        const usageData = await getUserUsageStatus(user.id);

        if (usageData?.is_pro && usageData?.onboarding_completed) {
          // User is already a pro subscriber, redirect to dashboard
          router.push('/');
        }
      }
    };
    checkUserStatus();
  }, [router]);

  const handleLogout = async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
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
    if (currentStep === 1) {
      setIsSubmitting(true);
      try {
        const checkoutUrl = await createCheckoutSession({
          annual: isMonthly,
          withTrial: true,
        });
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

  // Skip subscription and go directly to dashboard
  const handleSkipSubscription = async () => {
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

      // Mark onboarding as completed without subscription
      await upsertUserUsage(user.id, {
        onboarding_completed: true,
      });

      router.push('/');
    } catch (error) {
      console.error('Failed to skip subscription:', error);
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
            <CardHeader>
              <CardTitle>Welcome to Octree!</CardTitle>
              <CardDescription>
                Let's start by learning a bit about you.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
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
            </CardContent>
          </>
        );

      case 1:
        return (
          <>
            <CardHeader>
              <CardTitle>Subscribe to Octree Pro</CardTitle>
              <CardDescription>
                Everything you need for professional LaTeX documents.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
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

              <div className="space-y-1">
                <p className="text-2xl font-bold">$0.00 for 3 days</p>
                {isMonthly && (
                  <p className="text-sm text-muted-foreground">$9.99 billed monthly</p>
                )}
                {!isMonthly && (
                  <p className="text-sm text-muted-foreground">$4.99 billed weekly</p>
                )}
              </div>

              <div>
                <p className="mb-4 text-sm font-semibold">Octree includes</p>
                <FeatureList />
              </div>
            </CardContent>
          </>
        );

      default:
        return null;
    }
  };

  const isStepValid = () => {
    if (currentStep === 0) return !!role && !!useCase && !!referralSource;
    if (currentStep === 1) return true; // Subscription step is always valid
    return false;
  };

  return (
    <div className="flex min-h-screen w-full">
      {/* Left side - Onboarding form */}
      <div className="flex w-full flex-col p-6 lg:w-1/2">
        {/* Logo and name at top */}
        <div className="mb-8 flex items-center gap-2">
          <OctreeLogo className="h-6 w-6" />
          <span className="text-lg font-medium tracking-tight text-neutral-900">
            Octree
          </span>
        </div>

        {/* Center the form */}
        <div className="flex flex-1 items-center justify-center">
          <div className="w-full max-w-md space-y-6">
            <Card>
              {renderStep()}
              <CardContent className="pt-0 space-y-3">
                <Button
                  className="w-full"
                  variant="gradient"
                  onClick={handleNext}
                  disabled={isSubmitting || !isStepValid()}
                >
                  {isSubmitting
                    ? currentStep === 1
                      ? 'Loading...'
                      : 'Saving...'
                    : currentStep === TOTAL_STEPS - 1
                      ? 'Start Free Trial →'
                      : 'Continue'}
                </Button>
                {currentStep === 1 && (
                  <Button
                    className="w-full"
                    variant="ghost"
                    onClick={handleSkipSubscription}
                    disabled={isSubmitting}
                  >
                    Skip for now
                  </Button>
                )}
              </CardContent>
            </Card>

            {/* Progress dots with back button and user info below card */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <ProgressDots
                  currentStep={currentStep}
                  totalSteps={TOTAL_STEPS}
                />
                {currentStep > 0 && (
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
                {userEmail && (
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
