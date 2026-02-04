'use client';

import { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

const GENERATE_STEPS = [
  {
    target: 'generate-welcome',
    title: 'AI document generator',
    description:
      'Describe the document you want and the AI will generate LaTeX for you. You can get resumes, homework, letters, or any structured document in seconds.',
  },
  {
    target: 'generate-prompt',
    title: 'Describe what you want',
    description:
      'Type your request in this box. For example: "A one-page academic CV", "Math homework with 3 algebra problems", or "A cover letter for a software job".',
  },
  {
    target: 'generate-attach',
    title: 'Attach files (optional)',
    description:
      'Click the paperclip to add images or PDFs. The AI can use them as reference—e.g. a photo of a worksheet or a PDF template.',
  },
  {
    target: 'generate-send',
    title: 'Send to generate',
    description:
      'Press this button or hit Enter to start. The AI will stream the LaTeX document. When it’s done, you’ll see a preview below and can open it in the full editor.',
  },
  {
    target: 'generate-sidebar',
    title: 'Your generated documents',
    description:
      'Past generations appear here. Click any document to view it again or copy its content. Use "New chat" to start a fresh request.',
  },
  {
    target: 'generate-preview',
    title: 'Preview and open in editor',
    description:
      'After generating, the document preview appears here. You can open it in the full Octree editor to edit, compile to PDF, and use AI chat for changes.',
  },
] as const;

interface GenerateOnboardingProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onComplete?: () => void;
}

export function GenerateOnboarding({
  open,
  onOpenChange,
  onComplete,
}: GenerateOnboardingProps) {
  const [step, setStep] = useState(0);
  const [targetRect, setTargetRect] = useState<DOMRect | null>(null);
  const [cardPosition, setCardPosition] = useState<{ top: number; left: number } | null>(null);

  const current = GENERATE_STEPS[step];
  const isLast = step === GENERATE_STEPS.length - 1;
  const isFirst = step === 0;

  const measureTarget = useCallback(() => {
    if (typeof document === 'undefined') return;
    const stepConfig = GENERATE_STEPS[step];
    if (!stepConfig) return;
    const el = document.querySelector(
      `[data-onboarding-target="${stepConfig.target}"]`
    );
    if (el) {
      const rect = el.getBoundingClientRect();
      setTargetRect(rect);
      const padding = 12;
      const cardWidth = 320;
      const cardHeight = 220;
      const viewportPadding = 16;
      const targetCenterX = rect.left + rect.width / 2;
      const viewportMid = window.innerWidth / 2;

      let top = rect.bottom + padding;
      let left: number;
      if (targetCenterX < viewportMid && rect.right + padding + cardWidth <= window.innerWidth - viewportPadding) {
        left = rect.right + padding;
      } else {
        left = rect.left + rect.width / 2 - cardWidth / 2;
      }
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
    const stepConfig = GENERATE_STEPS[step];
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
      aria-labelledby="generate-onboarding-title"
      aria-describedby="generate-onboarding-desc"
    >
      {!targetRect && (
        <div
          className="absolute inset-0 bg-black/50 transition-opacity duration-200"
          onClick={() => handleClose(false)}
          aria-hidden
        />
      )}

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

      {cardPosition && current && (
        <div
          className="absolute z-[110] w-80 rounded-lg border border-slate-200 bg-white p-4 shadow-xl"
          style={{ top: cardPosition.top, left: cardPosition.left }}
          onClick={(e) => e.stopPropagation()}
        >
          <h2
            id="generate-onboarding-title"
            className="mb-2 text-sm font-semibold text-neutral-900"
          >
            {current.title}
          </h2>
          <p
            id="generate-onboarding-desc"
            className="mb-4 text-sm text-neutral-600"
          >
            {current.description}
          </p>
          <div className="flex items-center justify-between">
            <div className="flex gap-1">
              {GENERATE_STEPS.map((_, i) => (
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

      {current && !targetRect && (
        <div
          className="absolute left-1/2 top-1/2 z-[110] w-80 -translate-x-1/2 -translate-y-1/2 rounded-lg border border-slate-200 bg-white p-4 shadow-xl"
          onClick={(e) => e.stopPropagation()}
        >
          <h2
            id="generate-onboarding-title"
            className="mb-2 text-sm font-semibold text-neutral-900"
          >
            {current.title}
          </h2>
          <p
            id="generate-onboarding-desc"
            className="mb-4 text-sm text-neutral-600"
          >
            {current.description}
          </p>
          <div className="flex items-center justify-between">
            <div className="flex gap-1">
              {GENERATE_STEPS.map((_, i) => (
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

      <button
        type="button"
        onClick={() => handleClose(false)}
        className="absolute right-4 top-4 z-[110] rounded-md p-1.5 text-slate-400 hover:bg-white/10 hover:text-white focus:outline-none focus:ring-2 focus:ring-white"
        aria-label="Close tour"
      >
        <svg
          className="h-5 w-5"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M6 18L18 6M6 6l12 12"
          />
        </svg>
      </button>
    </div>
  );

  return createPortal(overlay, document.body);
}
