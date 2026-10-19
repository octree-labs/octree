'use client';

import { useState, useEffect, useLayoutEffect, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface WalkthroughStep {
  target: string;
  title: string;
  description: string;
}

const GENERATE_STEP: WalkthroughStep = {
  target: 'dashboard-generate-button',
  title: 'Create documents with AI',
  description:
    'Nothing to bring? "Generate with AI" opens the generator, where you describe what you want and get a LaTeX document in seconds.',
};

/** The populated dashboard: action cards, header, New Project / Import, the table. */
const PROJECT_STEPS: readonly WalkthroughStep[] = [
  GENERATE_STEP,
  {
    target: 'dashboard-header',
    title: 'Your dashboard',
    description:
      'This is your projects hub. From here you can bring your own document, start a new project, or jump into any existing one.',
  },
  {
    target: 'dashboard-new-project',
    title: 'New project',
    description:
      'Start a blank LaTeX project from here, or import a .zip / .tex you already have. Add files and folders, then write in the editor.',
  },
  {
    target: 'dashboard-projects',
    title: 'Your projects',
    description:
      'All your projects appear here. Click one to open it in the editor, or use the menu (⋯) to rename or delete it.',
  },
];

/**
 * The empty dashboard ("Start with your document"): the same targets, but the
 * spotlight starts on the option cards, which are the main action there, and
 * the Generate text link comes last.
 */
const EMPTY_STEPS: readonly WalkthroughStep[] = [
  {
    target: 'dashboard-header',
    title: 'Start with your document',
    description:
      'Your first project is best started from LaTeX you already have. Once it exists, this becomes your projects hub.',
  },
  {
    target: 'dashboard-projects',
    title: 'Bring your document',
    description:
      'Upload a .tex or a ZIP (an Overleaf export works as-is), paste LaTeX, or try the sample article. It opens in the editor and compiles right away.',
  },
  {
    target: 'dashboard-new-project',
    title: 'Or start blank',
    description:
      'An empty article template to write from scratch. You can add files and folders in the editor.',
  },
  GENERATE_STEP,
];

export type DashboardWalkthroughVariant = 'projects' | 'empty';

function stepsFor(variant: DashboardWalkthroughVariant, skipGenerate: boolean): WalkthroughStep[] {
  const steps = variant === 'empty' ? EMPTY_STEPS : PROJECT_STEPS;
  return skipGenerate ? steps.filter((step) => step !== GENERATE_STEP) : [...steps];
}

interface DashboardOnboardingProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onComplete?: () => void;
  /** `empty` when the user has no projects yet (the "Start with your document" state). */
  variant?: DashboardWalkthroughVariant;
  /** Leave out the Generate step (the user already took the generator's own tour). */
  skipGenerate?: boolean;
}

export function DashboardOnboarding({
  open,
  onOpenChange,
  onComplete,
  variant = 'projects',
  skipGenerate = false,
}: DashboardOnboardingProps) {
  const DASHBOARD_STEPS = useMemo(() => stepsFor(variant, skipGenerate), [variant, skipGenerate]);
  const [step, setStep] = useState(0);
  const [targetRect, setTargetRect] = useState<DOMRect | null>(null);
  const [cardPosition, setCardPosition] = useState<{ top: number; left: number } | null>(null);
  const [measureAttempted, setMeasureAttempted] = useState(false);

  const current = DASHBOARD_STEPS[step];
  const isLast = step === DASHBOARD_STEPS.length - 1;
  const isFirst = step === 0;

  const measureTarget = useCallback(() => {
    if (typeof document === 'undefined') return;
    const stepConfig = DASHBOARD_STEPS[step];
    if (!stepConfig) return;
    const el = document.querySelector(
      `[data-onboarding-target="${stepConfig.target}"]`
    );
    if (el) {
      const rect = el.getBoundingClientRect();
      setTargetRect(rect);
      const padding = 12;
      const cardWidth = 320;
      const cardHeight = 200;
      const viewportPadding = 16;
      let top = rect.bottom + padding;
      let left = rect.left + rect.width / 2 - cardWidth / 2;
      if (top + cardHeight > window.innerHeight - viewportPadding) {
        top = rect.top - cardHeight - padding;
      }
      if (top < viewportPadding) top = viewportPadding;
      if (left < viewportPadding) left = viewportPadding;
      if (left + cardWidth > window.innerWidth - viewportPadding) {
        left = window.innerWidth - cardWidth - viewportPadding;
      }
      setCardPosition({ top, left });
    } else {
      setTargetRect(null);
      setCardPosition(null);
      setMeasureAttempted(true);
    }
  }, [step, DASHBOARD_STEPS]);

  useEffect(() => {
    if (open) {
      setStep(0);
      setTargetRect(null);
      setCardPosition(null);
      setMeasureAttempted(false);
    }
  }, [open, DASHBOARD_STEPS]);

  useLayoutEffect(() => {
    if (!open) return;
    measureTarget();
  }, [open, step, measureTarget]);

  useEffect(() => {
    if (!open) return;
    const stepConfig = DASHBOARD_STEPS[step];
    const el = stepConfig
      ? document.querySelector(
          `[data-onboarding-target="${stepConfig.target}"]`
        )
      : null;
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
    }
    const t = setTimeout(measureTarget, 250);
    const onResizeOrScroll = () => measureTarget();
    window.addEventListener('resize', onResizeOrScroll);
    window.addEventListener('scroll', onResizeOrScroll, true);
    return () => {
      clearTimeout(t);
      window.removeEventListener('resize', onResizeOrScroll);
      window.removeEventListener('scroll', onResizeOrScroll, true);
    };
  }, [open, step, measureTarget, DASHBOARD_STEPS]);

  const handleNext = () => {
    if (isLast) {
      onComplete?.();
      onOpenChange(false);
    } else {
      setTargetRect(null);
      setCardPosition(null);
      setMeasureAttempted(false);
      setStep((s) => s + 1);
    }
  };

  const handleBack = () => {
    if (isFirst) return;
    setTargetRect(null);
    setCardPosition(null);
    setMeasureAttempted(false);
    setStep((s) => s - 1);
  };

  const handleClose = (next: boolean) => {
    if (!next) onComplete?.();
    setStep(0);
    setTargetRect(null);
    setCardPosition(null);
    onOpenChange(next);
  };

  if (!open || typeof document === 'undefined') return null;

  const overlay = (
    <div
      className="pointer-events-none fixed inset-0 z-[100]"
      role="dialog"
      aria-modal="true"
      aria-labelledby="onboarding-title"
      aria-describedby="onboarding-desc"
    >
      {/* Backdrop: full-page dim when no target; pointer-events-auto so clicks close */}
      {!targetRect && (
        <div
          className="pointer-events-auto absolute inset-0 bg-black/50 transition-opacity duration-200"
          onClick={() => handleClose(false)}
          aria-hidden
        />
      )}

      {/* When spotlight: 4 strips around the hole; pointer-events-auto so dimmed-area clicks close, hole stays click-through to page */}
      {targetRect && (
        <>
          <div
            className="pointer-events-auto absolute left-0 top-0 bg-transparent"
            style={{ width: '100%', height: targetRect.top }}
            onClick={() => handleClose(false)}
            aria-hidden
          />
          <div
            className="pointer-events-auto absolute left-0 bg-transparent"
            style={{
              top: targetRect.bottom,
              width: '100%',
              height: window.innerHeight - targetRect.bottom,
            }}
            onClick={() => handleClose(false)}
            aria-hidden
          />
          <div
            className="pointer-events-auto absolute top-0 bg-transparent"
            style={{
              left: 0,
              top: targetRect.top,
              width: targetRect.left,
              height: targetRect.height,
            }}
            onClick={() => handleClose(false)}
            aria-hidden
          />
          <div
            className="pointer-events-auto absolute top-0 bg-transparent"
            style={{
              left: targetRect.right,
              top: targetRect.top,
              width: window.innerWidth - targetRect.right,
              height: targetRect.height,
            }}
            onClick={() => handleClose(false)}
            aria-hidden
          />
        </>
      )}

      {/* Spotlight: hole-sized div with huge box-shadow = dim everywhere except hole. No pointer-events so hole is click-through. */}
      {targetRect && (
        <>
          <div
            className="pointer-events-none absolute rounded-lg transition-all duration-200"
            style={{
              left: targetRect.left,
              top: targetRect.top,
              width: targetRect.width,
              height: targetRect.height,
              boxShadow: '0 0 0 999vmax rgba(0,0,0,0.5)',
            }}
            aria-hidden
          />
          <div
            className="pointer-events-none absolute rounded-lg border-2 border-primary ring-2 ring-primary/30 ring-offset-2 ring-offset-transparent transition-all duration-200"
            style={{
              left: targetRect.left - 4,
              top: targetRect.top - 4,
              width: targetRect.width + 8,
              height: targetRect.height + 8,
            }}
          />
        </>
      )}

      {/* Floating card - pointer-events-auto so Skip/Back/Next work */}
      {cardPosition && current && (
        <div
          className="pointer-events-auto absolute z-[110] w-80 rounded-lg border border-slate-200 bg-white p-4 shadow-xl"
          style={{
            top: cardPosition.top,
            left: cardPosition.left,
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <h2 id="onboarding-title" className="mb-2 text-sm font-semibold text-neutral-900">
            {current.title}
          </h2>
          <p id="onboarding-desc" className="mb-4 text-sm text-neutral-600">
            {current.description}
          </p>
          <div className="flex items-center justify-between">
            <div className="flex gap-1">
              {DASHBOARD_STEPS.map((_, i) => (
                <div
                  key={i}
                  className={cn(
                    'h-1.5 w-1.5 rounded-full transition-colors',
                    i === step ? 'bg-primary' : 'bg-slate-200'
                  )}
                  aria-hidden
                />
              ))}
            </div>
            <div className="flex gap-2">
              <Button
                variant="ghost"
                size="sm"
                className="text-muted-foreground"
                onClick={() => handleClose(false)}
              >
                Skip
              </Button>
              {!isFirst && (
                <Button variant="ghost" size="sm" onClick={handleBack}>
                  Back
                </Button>
              )}
              <Button variant="gradient" size="sm" onClick={handleNext}>
                {isLast ? 'Get started' : 'Next'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Fallback when target not found: show card in center only after measure attempted (avoids card flashing in middle then jumping) */}
      {current && !targetRect && measureAttempted && (
        <div
          className="pointer-events-auto absolute left-1/2 top-1/2 z-[110] w-80 -translate-x-1/2 -translate-y-1/2 rounded-lg border border-slate-200 bg-white p-4 shadow-xl"
          onClick={(e) => e.stopPropagation()}
        >
          <h2 id="onboarding-title" className="mb-2 text-sm font-semibold text-neutral-900">
            {current.title}
          </h2>
          <p id="onboarding-desc" className="mb-4 text-sm text-neutral-600">
            {current.description}
          </p>
          <div className="flex items-center justify-between">
            <div className="flex gap-1">
              {DASHBOARD_STEPS.map((_, i) => (
                <div
                  key={i}
                  className={cn(
                    'h-1.5 w-1.5 rounded-full transition-colors',
                    i === step ? 'bg-primary' : 'bg-slate-200'
                  )}
                  aria-hidden
                />
              ))}
            </div>
            <div className="flex gap-2">
              <Button
                variant="ghost"
                size="sm"
                className="text-muted-foreground"
                onClick={() => handleClose(false)}
              >
                Skip
              </Button>
              {!isFirst && (
                <Button variant="ghost" size="sm" onClick={handleBack}>
                  Back
                </Button>
              )}
              <Button variant="gradient" size="sm" onClick={handleNext}>
                {isLast ? 'Get started' : 'Next'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Close button - top right; pointer-events-auto so it's clickable */}
      <button
        type="button"
        onClick={() => handleClose(false)}
        className="pointer-events-auto absolute right-4 top-4 z-[110] rounded-md p-1.5 text-slate-400 hover:bg-white/10 hover:text-white focus:outline-none focus:ring-2 focus:ring-white"
        aria-label="Close tour"
      >
        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  );

  return createPortal(overlay, document.body);
}
