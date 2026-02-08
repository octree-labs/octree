'use client';

import { useState, useEffect, useLayoutEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

const DASHBOARD_STEPS = [
  {
    target: 'dashboard-generate-button',
    title: 'Create documents with AI',
    description:
      'Click the "Generate with AI" button above to open the generator. There you can describe what you want and get a LaTeX document in seconds.',
    hideNext: true,
  },
  {
    target: 'dashboard-header',
    title: 'Your dashboard',
    description:
      'This is your projects hub. From here you can create new projects, open the AI generator, or jump into any existing project.',
  },
  {
    target: 'dashboard-new-project',
    title: 'New project',
    description:
      'Click "+ New Project" to create an empty LaTeX project. You can add files and folders, then open the project in the editor to start writing.',
  },
  {
    target: 'dashboard-projects',
    title: 'Your projects',
    description:
      'All your projects are listed here. Click a row to open it in the editor, or use the menu (⋯) to rename or delete a project.',
  },
] as const;

interface DashboardOnboardingProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onComplete?: () => void;
  initialStep?: number;
}

const clampStep = (value: number) =>
  Math.max(0, Math.min(value, DASHBOARD_STEPS.length - 1));

export function DashboardOnboarding({
  open,
  onOpenChange,
  onComplete,
  initialStep = 0,
}: DashboardOnboardingProps) {
  const [step, setStep] = useState(() => clampStep(initialStep));
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
  }, [step]);

  useEffect(() => {
    if (open) {
      setStep(clampStep(initialStep));
      setTargetRect(null);
      setCardPosition(null);
      setMeasureAttempted(false);
    }
  }, [open, initialStep]);

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
  }, [open, step, measureTarget]);

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
              {!('hideNext' in current && current.hideNext) && (
                <Button variant="gradient" size="sm" onClick={handleNext}>
                  {isLast ? 'Get started' : 'Next'}
                </Button>
              )}
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
              {!('hideNext' in current && current.hideNext) && (
                <Button variant="gradient" size="sm" onClick={handleNext}>
                  {isLast ? 'Get started' : 'Next'}
                </Button>
              )}
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
