'use client';

import { useEffect, useState } from 'react';
import { Loader2, PauseCircle, Percent } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { AnalyticsEvents, type CancelSaveOffer } from '@/lib/analytics/events';
import { track } from '@/lib/analytics/track';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import type { CancelFeedback } from '@/lib/analytics/events';
import {
  applySaveDiscount,
  applySaveOnceOffer,
  cancelSubscription,
  fetchCancelOffers,
  pauseSubscription,
} from '@/lib/requests/subscription';
import {
  CANCEL_COMMENT_MAX_LENGTH,
  MISSING_FEATURE_MAX_LENGTH,
  PAUSE_MONTH_OPTIONS,
  SAVE_ONCE_PERCENT_OFF,
  SAVE_STEP_PAUSE_MONTHS,
  SAVE_COUPON_MONTHS,
  SAVE_COUPON_PERCENT_OFF,
  type PauseMonths,
  type SubscriptionOfferState,
} from '@/lib/stripe-subscription';

interface CancelDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type Step = 'offers' | 'reason' | 'save' | 'paused' | 'discounted' | 'saved_once' | 'canceled';

const REASONS: Array<{ value: CancelFeedback; label: string }> = [
  { value: 'unused', label: "I'm not using it enough" },
  { value: 'too_expensive', label: "It's too expensive" },
  { value: 'missing_features', label: "It's missing something I need" },
  { value: 'low_quality', label: 'Bugs or quality problems' },
  { value: 'switched_service', label: "I'm switching to another tool" },
  { value: 'other', label: 'Something else' },
];

function formatMoney(amount: number | null, currency: string): string {
  if (amount == null) return '';
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: currency.toUpperCase(),
  }).format(amount / 100);
}

function formatDate(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toLocaleDateString(undefined, {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

export function CancelDialog({ open, onOpenChange }: CancelDialogProps) {
  const [step, setStep] = useState<Step>('offers');
  const [offers, setOffers] = useState<SubscriptionOfferState | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<CancelFeedback | null>(null);
  const [comment, setComment] = useState('');
  // `missing_features`: "Which feature?" (stored on the event and in Stripe's cancellation comment).
  const [missingFeature, setMissingFeature] = useState('');
  // The save step is offered once per opening, after the reason.
  const [saveShown, setSaveShown] = useState(false);
  const [result, setResult] = useState<{
    until?: number | null;
    paidThrough?: number | null;
    periodEnd?: number;
  } | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setStep('offers');
    setOffers(null);
    setLoadError(null);
    setError(null);
    setBusy(null);
    setFeedback(null);
    setComment('');
    setMissingFeature('');
    setSaveShown(false);
    setResult(null);
    fetchCancelOffers()
      .then((data) => {
        if (!cancelled) setOffers(data);
      })
      .catch((err) => {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : 'Failed to load subscription');
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  const handleClose = () => {
    if (busy) return;
    onOpenChange(false);
  };

  const run = async (key: string, work: () => Promise<void>) => {
    setBusy(key);
    setError(null);
    try {
      await work();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setBusy(null);
    }
  };

  const handlePause = (months: PauseMonths) =>
    run(`pause-${months}`, async () => {
      const data = await pauseSubscription(months);
      setResult({
        until: data.subscription.paused_until,
        paidThrough: data.subscription.pause_paid_through,
      });
      setStep('paused');
    });

  const handleDiscount = () =>
    run('discount', async () => {
      await applySaveDiscount();
      setStep('discounted');
    });

  const doCancel = () =>
    run('cancel', async () => {
      if (!feedback) return;
      const data = await cancelSubscription(feedback, comment, {
        ...(feedback === 'missing_features' && missingFeature.trim() ? { missingFeature: missingFeature.trim() } : {}),
        saveOfferShown: saveShown,
      });
      setResult({ periodEnd: data.subscription.current_period_end });
      setStep('canceled');
    });

  // The save step's offers that still apply: 50% off the next payment
  // (once per subscription) and a one-month pause.
  const saveOffers: CancelSaveOffer[] = offers
    ? [
        ...(offers.save_offer_available ? (['discount_once'] as const) : []),
        ...(offers.paused_until == null && offers.effective_status !== 'paused' ? (['pause_1m'] as const) : []),
      ]
    : [];

  // Before confirming: one save step (if anything is left to offer), then the cancel.
  const handleCancel = () => {
    if (!feedback) return;
    if (!saveShown && saveOffers.length > 0) {
      setSaveShown(true);
      setStep('save');
      track(AnalyticsEvents.CANCEL_SAVE_OFFER_SHOWN, {
        feedback,
        offers: saveOffers,
        has_missing_feature: feedback === 'missing_features' && missingFeature.trim().length > 0,
      });
      return;
    }
    void doCancel();
  };

  const handleSaveOnce = () =>
    run('save-once', async () => {
      await applySaveOnceOffer(feedback ?? undefined);
      setStep('saved_once');
    });

  const handleSavePause = () =>
    run('save-pause', async () => {
      const data = await pauseSubscription(SAVE_STEP_PAUSE_MONTHS, feedback ? { feedback } : undefined);
      setResult({
        until: data.subscription.paused_until,
        paidThrough: data.subscription.pause_paid_through,
      });
      setStep('paused');
    });

  // A pause already set (active now or scheduled) rules both offers out: a
  // second pause is a no-op and a discount would only land on voided invoices.
  const alreadyPaused = offers ? offers.paused_until != null || offers.effective_status === 'paused' : false;
  const isOnFreePlan = offers?.effective_status === 'paused';
  const canPause = offers ? !alreadyPaused : false;
  const canDiscount = offers ? !offers.has_discount && !alreadyPaused : false;
  const hasOffers = canPause || canDiscount;
  const periodEndLabel = offers ? formatDate(offers.current_period_end) : '';
  const price = offers?.price;
  const priceNow = price ? formatMoney(price.unit_amount, price.currency) : '';
  const priceHalf = price && price.unit_amount != null
    ? formatMoney(Math.round(price.unit_amount / 2), price.currency)
    : '';

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md">
        {step === 'offers' && (
          <>
            <DialogHeader>
              <DialogTitle>Before you go</DialogTitle>
              <DialogDescription>
                {hasOffers
                  ? 'Two ways to keep Octree Pro without paying full price right now.'
                  : isOnFreePlan
                    ? 'Your subscription is paused and you are on the free plan. Cancelling turns off renewal for good; your projects stay.'
                    : 'Cancelling turns off renewal. You keep Pro until the end of the current period.'}
              </DialogDescription>
            </DialogHeader>

            {loadError && (
              <div className="rounded-md bg-red-50 p-3 text-sm text-red-600">{loadError}</div>
            )}

            {!offers && !loadError && (
              <div className="flex items-center gap-2 py-4 text-sm text-neutral-500">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading your subscription...
              </div>
            )}

            {offers && hasOffers && (
              <div className="space-y-3">
                {canPause && (
                  <div className="rounded-lg border p-4">
                    <div className="flex items-start gap-3">
                      <PauseCircle className="mt-0.5 h-5 w-5 shrink-0 text-neutral-700" />
                      <div className="space-y-1">
                        <p className="text-sm font-medium">Pause instead?</p>
                        <p className="text-sm text-neutral-600">
                          {periodEndLabel
                            ? `You keep Pro until ${periodEndLabel}, which you have already paid for. After that you are on the free plan with no charge until billing resumes. Your projects stay, and you can resume any time.`
                            : 'You keep Pro until the end of the period you have paid for, then you are on the free plan with no charge until billing resumes. Your projects stay, and you can resume any time.'}
                        </p>
                      </div>
                    </div>
                    <div className="mt-3 flex gap-2">
                      {PAUSE_MONTH_OPTIONS.map((months) => (
                        <Button
                          key={months}
                          variant="outline"
                          size="sm"
                          className="flex-1"
                          disabled={busy !== null}
                          onClick={() => handlePause(months)}
                        >
                          {busy === `pause-${months}` ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            `${months} month${months > 1 ? 's' : ''}`
                          )}
                        </Button>
                      ))}
                    </div>
                  </div>
                )}

                {canDiscount && (
                  <div className="rounded-lg border p-4">
                    <div className="flex items-start gap-3">
                      <Percent className="mt-0.5 h-5 w-5 shrink-0 text-neutral-700" />
                      <div className="space-y-1">
                        <p className="text-sm font-medium">
                          {SAVE_COUPON_PERCENT_OFF}% off your next {SAVE_COUPON_MONTHS} months
                        </p>
                        <p className="text-sm text-neutral-600">
                          {priceNow && priceHalf
                            ? `${priceHalf} instead of ${priceNow} per ${price?.interval ?? 'period'} for ${SAVE_COUPON_MONTHS} months, then the normal price. One time only.`
                            : `Half price for ${SAVE_COUPON_MONTHS} months, then the normal price. One time only.`}
                        </p>
                      </div>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      className="mt-3 w-full"
                      disabled={busy !== null}
                      onClick={handleDiscount}
                    >
                      {busy === 'discount' ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        'Apply the discount'
                      )}
                    </Button>
                  </div>
                )}
              </div>
            )}

            {error && <div className="rounded-md bg-red-50 p-3 text-sm text-red-600">{error}</div>}

            <DialogFooter className="sm:justify-between">
              <Button variant="outline" onClick={handleClose} disabled={busy !== null}>
                Keep subscription
              </Button>
              <Button
                variant="ghost"
                className="text-neutral-600"
                disabled={!offers || busy !== null}
                onClick={() => setStep('reason')}
              >
                Continue to cancel
              </Button>
            </DialogFooter>
          </>
        )}

        {step === 'reason' && (
          <>
            <DialogHeader>
              <DialogTitle>Why are you cancelling?</DialogTitle>
              <DialogDescription>
                One answer helps us fix the right thing. You keep Pro until the end of the current period.
              </DialogDescription>
            </DialogHeader>

            <fieldset className="space-y-2">
              <legend className="sr-only">Reason</legend>
              {REASONS.map((reason) => (
                <label
                  key={reason.value}
                  className="flex cursor-pointer items-center gap-3 rounded-md border px-3 py-2 text-sm has-[:checked]:border-neutral-900"
                >
                  <input
                    type="radio"
                    name="cancel-reason"
                    value={reason.value}
                    checked={feedback === reason.value}
                    onChange={() => setFeedback(reason.value)}
                    className="h-4 w-4 accent-neutral-900"
                  />
                  {reason.label}
                </label>
              ))}
            </fieldset>

            {feedback === 'missing_features' && (
              <div className="space-y-1">
                <Label htmlFor="cancel-missing-feature" className="text-sm text-neutral-600">
                  Which feature?
                </Label>
                <Input
                  id="cancel-missing-feature"
                  value={missingFeature}
                  maxLength={MISSING_FEATURE_MAX_LENGTH}
                  onChange={(e) => setMissingFeature(e.target.value)}
                  placeholder="The one thing Octree didn't do for you"
                />
              </div>
            )}

            <div className="space-y-1">
              <Label htmlFor="cancel-comment" className="text-sm text-neutral-600">
                Anything else? (optional)
              </Label>
              <Textarea
                id="cancel-comment"
                value={comment}
                maxLength={CANCEL_COMMENT_MAX_LENGTH}
                onChange={(e) => setComment(e.target.value)}
                placeholder="What would have made you stay?"
                className="min-h-20"
              />
            </div>

            {error && <div className="rounded-md bg-red-50 p-3 text-sm text-red-600">{error}</div>}

            <DialogFooter className="sm:justify-between">
              <Button
                variant="outline"
                onClick={() => setStep('offers')}
                disabled={busy !== null}
              >
                Back
              </Button>
              <Button
                variant="destructive"
                onClick={handleCancel}
                disabled={!feedback || busy !== null}
              >
                {busy === 'cancel' ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Cancelling...
                  </>
                ) : (
                  'Cancel subscription'
                )}
              </Button>
            </DialogFooter>
          </>
        )}

        {step === 'save' && (
          <>
            <DialogHeader>
              <DialogTitle>Before you cancel</DialogTitle>
              <DialogDescription>
                {feedback === 'missing_features'
                  ? 'Thanks for telling us what was missing; we read every answer. If you want to give it a little longer:'
                  : 'If you want to give Octree a little longer:'}
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-3">
              {saveOffers.includes('discount_once') && (
                <Button
                  variant="outline"
                  className="h-auto w-full justify-start gap-3 py-3 text-left"
                  disabled={busy !== null}
                  onClick={handleSaveOnce}
                >
                  {busy === 'save-once' ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Percent className="h-4 w-4 shrink-0" />
                  )}
                  <span>
                    <span className="block text-sm font-medium">{SAVE_ONCE_PERCENT_OFF}% off your next payment</span>
                    <span className="block text-xs font-normal text-neutral-600">
                      {priceNow && priceHalf
                        ? `${priceHalf} instead of ${priceNow} next time, then the normal price.`
                        : 'Half price next time, then the normal price.'}
                    </span>
                  </span>
                </Button>
              )}
              {saveOffers.includes('pause_1m') && (
                <Button
                  variant="outline"
                  className="h-auto w-full justify-start gap-3 py-3 text-left"
                  disabled={busy !== null}
                  onClick={handleSavePause}
                >
                  {busy === 'save-pause' ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <PauseCircle className="h-4 w-4 shrink-0" />
                  )}
                  <span>
                    <span className="block text-sm font-medium">Pause for 1 month</span>
                    <span className="block text-xs font-normal text-neutral-600">
                      Keep Pro until {periodEndLabel || 'the end of this period'}, then no charge for a month.
                    </span>
                  </span>
                </Button>
              )}
            </div>

            {error && <div className="rounded-md bg-red-50 p-3 text-sm text-red-600">{error}</div>}

            <DialogFooter className="sm:justify-between">
              <Button variant="outline" onClick={handleClose} disabled={busy !== null}>
                Keep subscription
              </Button>
              <Button variant="destructive" onClick={() => void doCancel()} disabled={busy !== null}>
                {busy === 'cancel' ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Cancelling...
                  </>
                ) : (
                  'No thanks, cancel'
                )}
              </Button>
            </DialogFooter>
          </>
        )}

        {step === 'saved_once' && (
          <>
            <DialogHeader>
              <DialogTitle>Discount applied</DialogTitle>
              <DialogDescription>
                Your next payment is {SAVE_ONCE_PERCENT_OFF}% off and your subscription stays on. Nothing else changes.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button onClick={handleClose}>Done</Button>
            </DialogFooter>
          </>
        )}

        {step === 'paused' && (
          <>
            <DialogHeader>
              <DialogTitle>Subscription paused</DialogTitle>
              <DialogDescription>
                {result?.until
                  ? `You keep Pro until ${formatDate(result.paidThrough ?? offers?.current_period_end ?? result.until)}. From then until ${formatDate(result.until)} you are on the free plan and nothing is charged; billing and Pro resume on that date. Your projects stay where they are, and you can resume earlier from Settings any time.`
                  : 'You keep Pro until the end of the period you have paid for, then you are on the free plan until billing resumes. Your projects stay where they are.'}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button onClick={handleClose}>Done</Button>
            </DialogFooter>
          </>
        )}

        {step === 'discounted' && (
          <>
            <DialogHeader>
              <DialogTitle>Discount applied</DialogTitle>
              <DialogDescription>
                Your next {SAVE_COUPON_MONTHS} months are {SAVE_COUPON_PERCENT_OFF}% off. Nothing else changes.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button onClick={handleClose}>Done</Button>
            </DialogFooter>
          </>
        )}

        {step === 'canceled' && (
          <>
            <DialogHeader>
              <DialogTitle>Renewal turned off</DialogTitle>
              <DialogDescription>
                {result?.periodEnd
                  ? `You keep Pro until ${formatDate(result.periodEnd)}. Your projects stay after that too.`
                  : 'You keep Pro until the end of the current period. Your projects stay after that too.'}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button onClick={handleClose}>Done</Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
