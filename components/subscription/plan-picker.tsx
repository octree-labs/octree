'use client';

import { useState } from 'react';
import { GraduationCap, Zap } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { CREDIT_PACKS, PRO_PLANS, type ProPlanId } from '@/data/constants';
import { createCheckoutSession } from '@/lib/requests/subscription';
import type { CheckoutSource } from '@/lib/analytics/events';

export type PickerPlan = ProPlanId;

interface PlanPickerProps {
  plan: PickerPlan;
  onPlanChange: (plan: PickerPlan) => void;
  /** Where the picker is shown; only used for `checkout_started`. */
  source: CheckoutSource;
  /** Hide the recurring plans and offer only the credit pack. */
  creditsOnly?: boolean;
  /** Hide the credit pack row. */
  hideCredits?: boolean;
  disabled?: boolean;
  className?: string;
}

/**
 * The one place the app shows what it sells: Monthly / Annual toggle, the
 * Semester pass, and the 100-edit credit pack. Used by the paywall dialog,
 * onboarding, /buy, the settings card and the generate preview. Labels and
 * prices come from PRO_PLANS / CREDIT_PACKS in data/constants.ts.
 *
 * The picker only selects the recurring plan; the host renders its own
 * primary button and calls `createCheckoutSession({ plan })`. The credit
 * pack is a one-time purchase with no selection step, so its button starts
 * checkout directly.
 */
export function PlanPicker({
  plan,
  onPlanChange,
  source,
  creditsOnly = false,
  hideCredits = false,
  disabled = false,
  className,
}: PlanPickerProps) {
  const [isBuyingCredits, setIsBuyingCredits] = useState(false);
  const selected = PRO_PLANS[plan];
  const pack = CREDIT_PACKS.credits_100;

  const handleBuyCredits = async () => {
    setIsBuyingCredits(true);
    try {
      const url = await createCheckoutSession({ plan: 'credits_100', source });
      window.location.href = url;
    } catch (error) {
      console.error('Failed to start credits checkout:', error);
      toast.error('Failed to start checkout. Please try again.');
      setIsBuyingCredits(false);
    }
  };

  return (
    <div className={cn('space-y-4', className)}>
      {!creditsOnly && (
        <>
          <div
            role="radiogroup"
            aria-label="Billing period"
            className="inline-flex w-full items-center rounded-full bg-muted p-1"
          >
            {(['monthly', 'annual'] as const).map((id) => {
              const option = PRO_PLANS[id];
              const active = plan === id;
              return (
                <button
                  key={id}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  disabled={disabled}
                  onClick={() => onPlanChange(id)}
                  className={cn(
                    'flex flex-1 items-center justify-center gap-2 rounded-full px-3 py-1.5 text-sm font-medium transition-all',
                    active
                      ? 'bg-background text-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground'
                  )}
                >
                  {option.label}
                  {id === 'annual' && (
                    <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
                      {PRO_PLANS.annual.badge}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          <div className="space-y-1">
            <div className="flex items-baseline gap-2">
              <p className="text-3xl font-bold">{selected.price}</p>
              <p className="text-sm text-muted-foreground">{selected.intervalLabel}</p>
              {plan === 'annual' && (
                <p className="text-sm text-muted-foreground">
                  {PRO_PLANS.annual.monthlyEquivalent}/mo
                </p>
              )}
            </div>
            <p className="text-xs text-muted-foreground">{selected.billingNote}</p>
          </div>

          <button
            type="button"
            role="radio"
            aria-checked={plan === 'semester'}
            aria-label={PRO_PLANS.semester.label}
            disabled={disabled}
            onClick={() => onPlanChange('semester')}
            className={cn(
              'flex w-full items-center gap-3 rounded-lg border p-3 text-left transition-colors',
              plan === 'semester'
                ? 'border-primary bg-primary/5'
                : 'border-border hover:border-foreground/30'
            )}
          >
            <GraduationCap className="h-5 w-5 shrink-0 text-muted-foreground" />
            <span className="flex-1">
              <span className="block text-sm font-medium">
                {PRO_PLANS.semester.label}
                <span className="ml-1.5 text-xs font-normal text-muted-foreground">for students</span>
              </span>
              <span className="block text-xs text-muted-foreground">
                {PRO_PLANS.semester.tagline}. Cancel anytime.
              </span>
            </span>
            <span className="text-right">
              <span className="block text-base font-semibold">{PRO_PLANS.semester.price}</span>
              <span className="block text-[11px] text-muted-foreground">
                {PRO_PLANS.semester.intervalLabel}
              </span>
            </span>
          </button>
        </>
      )}

      {!hideCredits && (
        <div
          className={cn(
            'flex items-center justify-between gap-3 rounded-lg border border-dashed p-3',
            creditsOnly && 'border-solid'
          )}
        >
          <div className="min-w-0">
            <p className="flex items-center gap-1.5 text-sm font-medium">
              <Zap className="h-4 w-4 shrink-0 text-amber-500" />
              {pack.label}
            </p>
            <p className="text-xs text-muted-foreground">{pack.note}</p>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="shrink-0"
            onClick={handleBuyCredits}
            disabled={disabled || isBuyingCredits}
            aria-label={`Buy ${pack.label}`}
          >
            {isBuyingCredits ? 'Loading...' : `Buy for ${pack.price}`}
          </Button>
        </div>
      )}
    </div>
  );
}
