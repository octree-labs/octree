'use client';

import { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Button } from '@/components/ui/button';
import { Sparkles, FolderPlus, List } from 'lucide-react';
import { cn } from '@/lib/utils';

const DASHBOARD_STEPS = [
  {
    target: 'dashboard-header',
    title: 'Your dashboard',
    description:
      'This is your projects hub. Here you can see and manage all your LaTeX projects.',
    icon: List,
  },
  {
    target: 'dashboard-actions',
    title: 'Create or generate',
    description:
      '"Generate with AI" starts a document with AI. "New project" creates an empty LaTeX project you can edit.',
    icon: FolderPlus,
  },
  {
    target: 'dashboard-projects',
    title: 'Your projects',
    description:
      'Click any project to open the editor with live PDF preview and AI chat for edits.',
    icon: Sparkles,
  },
] as const;

interface DashboardOnboardingProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onComplete?: () => void;
}

export function DashboardOnboarding({
  open,
  onOpenChange,
  onComplete,
}: DashboardOnboardingProps) {
  const [step, setStep] = useState(0);
  const [targetRect, setTargetRect] = useState<DOMRect | null>(null);
  const [cardPosition, setCardPosition] = useState<{ top: number; left: number } | null>(null);

  const current = DASHBOARD_STEPS[step];
  const Icon = current?.icon ?? List;
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
    }
  }, [step]);

  useEffect(() => {
    if (open) setStep(0);
  }, [open]);

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
    const t = setTimeout(measureTarget, 200);
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
      setStep((s) => s + 1);
    }
  };

  const handleBack = () => {
    if (isFirst) return;
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
      className="fixed inset-0 z-[100]"
      role="dialog"
      aria-modal="true"
      aria-labelledby="onboarding-title"
      aria-describedby="onboarding-desc"
    >
      {/* Backdrop: full-page dim when no target */}
      {!targetRect && (
        <div
          className="absolute inset-0 bg-black/50 transition-opacity duration-200"
          onClick={() => handleClose(false)}
          aria-hidden
        />
      )}

      {/* When spotlight: 4 strips around the hole so dimmed-area clicks close, hole is click-through */}
      {targetRect && (
        <>
          <div
            className="absolute left-0 top-0 bg-transparent"
            style={{ width: '100%', height: targetRect.top }}
            onClick={() => handleClose(false)}
            aria-hidden
          />
          <div
            className="absolute left-0 bg-transparent"
            style={{
              top: targetRect.bottom,
              width: '100%',
              height: window.innerHeight - targetRect.bottom,
            }}
            onClick={() => handleClose(false)}
            aria-hidden
          />
          <div
            className="absolute top-0 bg-transparent"
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
            className="absolute top-0 bg-transparent"
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

      {/* Floating card */}
      {cardPosition && current && (
        <div
          className="absolute z-[110] w-80 rounded-lg border border-slate-200 bg-white p-4 shadow-xl"
          style={{
            top: cardPosition.top,
            left: cardPosition.left,
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="mb-3 flex items-center gap-2">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10">
              <Icon className="h-4 w-4 text-primary" />
            </div>
            <h2 id="onboarding-title" className="text-sm font-semibold text-neutral-900">
              {current.title}
            </h2>
          </div>
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
              {!isFirst && (
                <Button variant="ghost" size="sm" onClick={handleBack}>
                  Back
                </Button>
              )}
              <Button size="sm" onClick={handleNext}>
                {isLast ? 'Get started' : 'Next'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Fallback when target not found: show card in center */}
      {current && !targetRect && (
        <div
          className="absolute left-1/2 top-1/2 z-[110] w-80 -translate-x-1/2 -translate-y-1/2 rounded-lg border border-slate-200 bg-white p-4 shadow-xl"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="mb-3 flex items-center gap-2">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10">
              <Icon className="h-4 w-4 text-primary" />
            </div>
            <h2 id="onboarding-title" className="text-sm font-semibold text-neutral-900">
              {current.title}
            </h2>
          </div>
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
              {!isFirst && (
                <Button variant="ghost" size="sm" onClick={handleBack}>
                  Back
                </Button>
              )}
              <Button size="sm" onClick={handleNext}>
                {isLast ? 'Get started' : 'Next'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Close button - top right */}
      <button
        type="button"
        onClick={() => handleClose(false)}
        className="absolute right-4 top-4 z-[110] rounded-md p-1.5 text-slate-400 hover:bg-white/10 hover:text-white focus:outline-none focus:ring-2 focus:ring-white"
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
