'use client';

import { useState, useEffect, useRef } from 'react';
import { cn } from '@/lib/utils';
import { Check, Loader2, Timer } from 'lucide-react';

export type GenerationMilestone = 'started' | 'content_streaming' | 'finalizing' | 'complete';

const TIPS = [
  'Use \\usepackage{hyperref} to make URLs and cross-references clickable in your PDF.',
  'Use a non-breaking space ~ before \\cite{} and \\ref{} to prevent awkward line breaks.',
  'Define reusable commands with \\newcommand{\\name}[args]{definition} to keep your code DRY.',
  'Prefer \\usepackage{booktabs} with \\toprule, \\midrule, \\bottomrule for professional tables.',
  'Use \\includegraphics[width=\\textwidth]{file} to scale images to the column width.',
  'Set page margins easily with \\usepackage[margin=1in]{geometry}.',
  'Load \\usepackage{microtype} for subtle spacing improvements that make text look polished.',
  'Try \\usepackage{cleveref} — \\cref{fig:x} auto-inserts "Figure", "Table", etc.',
  'Format units with \\usepackage{siunitx} — e.g., \\SI{9.8}{m/s^2} for consistent notation.',
  'Add \\listoffigures and \\listoftables after \\tableofcontents for a complete document outline.',
];

const STEPS = [
  { id: 'thinking', label: 'Thinking...' },
  { id: 'generating', label: 'Generating document...' },
];

interface GenerationProgressTrackerProps {
  milestone: GenerationMilestone;
  children?: React.ReactNode;
}

function milestoneToPhase(milestone: GenerationMilestone): number {
  switch (milestone) {
    case 'started':
      return 0;
    case 'content_streaming':
    case 'finalizing':
      return 1;
    case 'complete':
      return STEPS.length;
  }
}

type StepStatus = 'pending' | 'in-progress' | 'completed';

function getStepStatuses(currentPhase: number): StepStatus[] {
  return STEPS.map((_, i) => {
    if (i < currentPhase) return 'completed';
    if (i === currentPhase) return 'in-progress';
    return 'pending';
  });
}

/* ── Tool UI Step Indicator (from tool-ui/progress-tracker) ── */

function StepIndicator({ status }: { status: StepStatus }) {
  if (status === 'pending') {
    return (
      <span
        className="bg-card border-border flex size-4 shrink-0 items-center justify-center rounded-full border motion-safe:transition-all motion-safe:duration-200"
        aria-hidden="true"
      />
    );
  }

  if (status === 'in-progress') {
    // Bare spinner, no circle, as in the resume redesign progress.
    return (
      <span
        className="flex size-4 shrink-0 items-center justify-center"
        aria-hidden="true"
      >
        <Loader2 className="text-primary size-3.5 motion-safe:animate-spin" />
      </span>
    );
  }

  // completed
  return (
    <span
      className="bg-gradient-to-t from-primary to-primary/85 text-primary-foreground border border-zinc-950/25 ring-1 ring-inset ring-white/20 dark:border-white/20 dark:ring-transparent flex size-4 shrink-0 items-center justify-center rounded-full motion-safe:animate-in motion-safe:fade-in motion-safe:zoom-in-75 motion-safe:duration-300 motion-safe:ease-out"
      aria-hidden="true"
    >
      <Check
        className="size-2.5 motion-safe:animate-in motion-safe:fade-in motion-safe:zoom-in-75 motion-safe:delay-75 motion-safe:duration-200 motion-safe:fill-mode-both"
        strokeWidth={3}
      />
    </span>
  );
}

/* ── Elapsed time helpers (from tool-ui/progress-tracker) ── */

function formatElapsedTime(milliseconds: number): string {
  const roundedSeconds = Math.round(Math.max(0, milliseconds) / 100) / 10;
  if (roundedSeconds < 60) return `${roundedSeconds.toFixed(1)}s`;
  const wholeSeconds = Math.floor(roundedSeconds);
  const minutes = Math.floor(wholeSeconds / 60);
  const remainingSeconds = wholeSeconds % 60;
  return `${minutes}m ${remainingSeconds}s`;
}

function formatElapsedTimeDateTime(milliseconds: number): string {
  const roundedSeconds = Math.round(Math.max(0, milliseconds) / 100) / 10;
  if (roundedSeconds < 60) return `PT${Number(roundedSeconds.toFixed(1))}S`;
  const wholeSeconds = Math.floor(roundedSeconds);
  const minutes = Math.floor(wholeSeconds / 60);
  const seconds = wholeSeconds % 60;
  const minutePart = minutes > 0 ? `${minutes}M` : '';
  const secondPart = seconds > 0 ? `${seconds}S` : '';
  return `PT${minutePart}${secondPart}`;
}

function ElapsedTimeBadge({ elapsedTime }: { elapsedTime: number }) {
  if (elapsedTime <= 0) return null;
  return (
    <div className="text-muted-foreground flex items-center gap-1 font-mono text-[11px]">
      <Timer className="-mt-px size-3" />
      <time dateTime={formatElapsedTimeDateTime(elapsedTime)}>
        {formatElapsedTime(elapsedTime)}
      </time>
    </div>
  );
}

/* ── Main component ── */

export function GenerationProgressTracker({
  milestone,
  children,
}: GenerationProgressTrackerProps) {
  const [elapsedMs, setElapsedMs] = useState(0);
  const [tipIndex, setTipIndex] = useState(() => Math.floor(Math.random() * TIPS.length));
  const [tipVisible, setTipVisible] = useState(true);
  const startTimeRef = useRef(Date.now());

  useEffect(() => {
    const interval = setInterval(() => {
      setElapsedMs(Date.now() - startTimeRef.current);
    }, 100);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const interval = setInterval(() => {
      setTipVisible(false);
      setTimeout(() => {
        setTipIndex((prev) => (prev + 1) % TIPS.length);
        setTipVisible(true);
      }, 300);
    }, 4000);
    return () => clearInterval(interval);
  }, []);

  const isComplete = milestone === 'complete';
  const currentPhase = isComplete ? STEPS.length : milestoneToPhase(milestone);
  const statuses = getStepStatuses(currentPhase);
  const hasInProgress = statuses.includes('in-progress');

  return (
    <article
      className={cn(
        'isolate flex w-full flex-col',
        'text-foreground select-none',
      )}
      data-slot="progress-tracker"
      role="status"
      aria-live="polite"
      aria-busy={hasInProgress}
    >
      <ol className="m-0 flex list-none flex-col gap-2 p-0">
        {STEPS.map((step, index) => {
          const status = statuses[index];
          const isCurrent = status === 'in-progress';
          const isGeneratingStep = step.id === 'generating';
          const showChildren = isGeneratingStep && children && (status === 'in-progress' || status === 'completed');

          return (
            <li
              key={step.id}
              className="relative"
              aria-current={isCurrent ? 'step' : undefined}
            >
              {/* Connector to the next step's indicator. The indicator spans
                  6-22px of the 28px row; the line runs from 4px below it to
                  4px above the next one (8px list gap + its 6px offset). */}
              {index < STEPS.length - 1 && (
                <div
                  className="bg-border absolute top-[26px] left-[7.5px] w-px motion-safe:transition-all motion-safe:duration-300"
                  style={{ height: 'calc(100% - 16px)' }}
                  aria-hidden="true"
                />
              )}

              {/* Step header row */}
              <div
                className={cn(
                  'relative z-10 flex items-center gap-2 py-1',
                  'motion-safe:transition-all motion-safe:duration-300',
                )}
              >
                <div className="relative z-10">
                  <StepIndicator status={status} />
                </div>
                <span
                  className={cn(
                    'text-xs leading-5 font-medium',
                    status === 'pending' && 'text-muted-foreground',
                  )}
                >
                  {step.label}
                </span>
                {isCurrent && (
                  <ElapsedTimeBadge elapsedTime={elapsedMs} />
                )}
              </div>

              {/* Children slot — Monaco editor nests inside "Generating" step */}
              {showChildren && (
                <div className="relative z-10 mt-1.5 ml-2 border-l border-border pl-4 pb-1.5">
                  {children}
                </div>
              )}
            </li>
          );
        })}
      </ol>

      {/* Tip — only show during thinking phase (no content yet) */}
      {!children && (
        <div className="mt-3 flex flex-col gap-2">
          <div className="bg-border h-px" />
          <p
            className="text-center text-[11px] leading-relaxed text-muted-foreground transition-opacity duration-300"
            style={{ opacity: tipVisible ? 1 : 0 }}
          >
            <span className="mr-1">💡</span>
            {TIPS[tipIndex]}
          </p>
        </div>
      )}
    </article>
  );
}
