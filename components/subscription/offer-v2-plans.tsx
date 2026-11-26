'use client';

import { Check, Clock, ShieldCheck } from 'lucide-react';

import { cn } from '@/lib/utils';
import {
  GUARANTEE_TITLE,
  TESTIMONIALS,
  formatCountdown,
  guaranteeText,
  offerValueStack,
  proofLine,
  type OfferPlan,
  type OfferPlanCopy,
} from '@/lib/offer-v2/offer';

interface OfferV2PlansProps {
  plans: Record<OfferPlan, OfferPlanCopy>;
  plan: OfferPlan;
  onPlanChange: (plan: OfferPlan) => void;
  /** Milliseconds left on the first-purchase offer; null or <= 0 hides the banner. */
  deadlineMsLeft: number | null;
  /** The first-purchase offer's banner text, e.g. "50% off your first month". */
  deadlineLabel?: string;
  proofCount?: number | null;
  /** Whether the Deadline Pass card is shown (after "Only need it for one deadline?"). */
  passRevealed: boolean;
  onRevealPass: () => void;
  disabled?: boolean;
}

const SUBSCRIPTION_ORDER: OfferPlan[] = ['annual', 'monthly', 'semester'];

/**
 * The `offer_v2` plan step body (lib/offer-v2/offer.ts): the honest
 * first-purchase countdown, the plans annual first, the Deadline Pass behind
 * a secondary link (the downsell), what Pro includes, the guarantee, and the
 * proof line. The host renders the headline and the checkout button.
 */
export function OfferV2Plans({
  plans,
  plan,
  onPlanChange,
  deadlineMsLeft,
  deadlineLabel,
  proofCount,
  passRevealed,
  onRevealPass,
  disabled = false,
}: OfferV2PlansProps) {
  const proof = proofLine(proofCount);
  const showDeadline = deadlineMsLeft !== null && deadlineMsLeft > 0 && !!deadlineLabel;

  return (
    <div className="space-y-4">
      {showDeadline && (
        <p
          className="flex items-center gap-2 rounded-md bg-amber-50 px-3 py-2 text-sm font-medium text-amber-900"
          role="status"
        >
          <Clock className="size-4 shrink-0" />
          {deadlineLabel}: ends in {formatCountdown(deadlineMsLeft)}
        </p>
      )}

      <div role="radiogroup" aria-label="Plan" className="space-y-2">
        {SUBSCRIPTION_ORDER.map((id) => (
          <PlanOption key={id} copy={plans[id]} selected={plan === id} onSelect={onPlanChange} disabled={disabled} />
        ))}
        {passRevealed ? (
          <PlanOption
            copy={plans.deadline_pass}
            selected={plan === 'deadline_pass'}
            onSelect={onPlanChange}
            disabled={disabled}
          />
        ) : (
          <button
            type="button"
            onClick={onRevealPass}
            disabled={disabled}
            className="block w-full text-center text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
          >
            Only need it for one deadline?
          </button>
        )}
      </div>

      <ul className="space-y-1.5">
        {offerValueStack().map((text) => (
          <li key={text} className="flex gap-2 text-sm text-muted-foreground">
            <Check className="mt-0.5 size-4 shrink-0 text-primary" />
            {text}
          </li>
        ))}
      </ul>

      <div className="flex gap-3 rounded-lg border border-emerald-200 bg-emerald-50/60 p-3">
        <ShieldCheck className="mt-0.5 size-5 shrink-0 text-emerald-700" />
        <div className="space-y-0.5">
          <p className="text-sm font-medium text-emerald-900">{GUARANTEE_TITLE}</p>
          <p className="text-xs text-emerald-900/80">{guaranteeText()}</p>
        </div>
      </div>

      {proof && <p className="text-center text-xs text-muted-foreground">{proof}</p>}

      {TESTIMONIALS.length > 0 && (
        <div className="space-y-2">
          {TESTIMONIALS.map((t) => (
            <figure key={`${t.name}-${t.quote.slice(0, 16)}`} className="rounded-md border p-3 text-sm">
              <blockquote className="text-foreground">&ldquo;{t.quote}&rdquo;</blockquote>
              <figcaption className="mt-1 text-xs text-muted-foreground">
                {t.name}
                {t.role ? `, ${t.role}` : ''}
              </figcaption>
            </figure>
          ))}
        </div>
      )}
    </div>
  );
}

function PlanOption({
  copy,
  selected,
  onSelect,
  disabled,
}: {
  copy: OfferPlanCopy;
  selected: boolean;
  onSelect: (plan: OfferPlan) => void;
  disabled: boolean;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      aria-label={copy.label}
      disabled={disabled}
      onClick={() => onSelect(copy.id)}
      className={cn(
        'flex w-full items-center gap-3 rounded-lg border bg-background p-3 text-left transition-colors disabled:cursor-not-allowed',
        selected ? 'border-primary ring-1 ring-primary' : 'border-border hover:border-primary/60'
      )}
    >
      <span
        aria-hidden
        className={cn(
          'flex size-4 shrink-0 items-center justify-center rounded-full border',
          selected ? 'border-primary' : 'border-muted-foreground/40'
        )}
      >
        {selected && <span className="size-2 rounded-full bg-primary" />}
      </span>
      <span className="flex-1">
        <span className="flex items-center gap-2 text-sm font-medium">
          {copy.label}
          {copy.badge && (
            <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
              {copy.badge}
            </span>
          )}
        </span>
        <span className="block text-xs text-muted-foreground">{copy.detail}</span>
      </span>
      <span className="text-right text-base font-semibold">{copy.price}</span>
    </button>
  );
}
