'use client';

import { useState, useEffect, useRef } from 'react';
import { cn } from '@/lib/utils';
import { Check, Loader2, Timer } from 'lucide-react';

const STEPS = [
  { id: 'thinking', label: 'Thinking...' },
  { id: 'writing', label: 'Writing response...' },
];

interface ChatProgressTrackerProps {
  hasContent: boolean;
}

type StepStatus = 'pending' | 'in-progress' | 'completed';

function getStepStatuses(hasContent: boolean): StepStatus[] {
  if (!hasContent) {
    return ['in-progress', 'pending'];
  }
  return ['completed', 'in-progress'];
}

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
    return (
      <span
        className="bg-card border-border flex size-4 shrink-0 items-center justify-center rounded-full border shadow-[0_0_0_3px_hsl(var(--primary)/0.1)] motion-safe:transition-all motion-safe:duration-300"
        aria-hidden="true"
      >
        <Loader2 className="text-primary size-3.5 motion-safe:animate-spin" />
      </span>
    );
  }

  return (
    <span
      className="bg-gradient-to-t from-primary to-primary/85 text-primary-foreground border border-zinc-950/25 shadow-sm shadow-zinc-950/20 ring-1 ring-inset ring-white/20 dark:border-white/20 dark:ring-transparent flex size-4 shrink-0 items-center justify-center rounded-full motion-safe:animate-in motion-safe:fade-in motion-safe:zoom-in-75 motion-safe:duration-300 motion-safe:ease-out"
      aria-hidden="true"
    >
      <Check
        className="size-2.5 motion-safe:animate-in motion-safe:fade-in motion-safe:zoom-in-75 motion-safe:delay-75 motion-safe:duration-200 motion-safe:fill-mode-both"
        strokeWidth={3}
      />
    </span>
  );
}

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
    <div className="text-muted-foreground flex items-center gap-1.5 font-mono text-xs">
      <Timer className="-mt-px size-3.5" />
      <time dateTime={formatElapsedTimeDateTime(elapsedTime)}>
        {formatElapsedTime(elapsedTime)}
      </time>
    </div>
  );
}

export function ChatProgressTracker({ hasContent }: ChatProgressTrackerProps) {
  const [elapsedMs, setElapsedMs] = useState(0);
  const startTimeRef = useRef(Date.now());

  useEffect(() => {
    const interval = setInterval(() => {
      setElapsedMs(Date.now() - startTimeRef.current);
    }, 100);
    return () => clearInterval(interval);
  }, []);

  const statuses = getStepStatuses(hasContent);
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
      <ol className="m-0 flex list-none flex-col gap-0 p-0">
        {STEPS.map((step, index) => {
          const status = statuses[index];
          const isCurrent = status === 'in-progress';

          return (
            <li
              key={step.id}
              className="relative"
              aria-current={isCurrent ? 'step' : undefined}
            >
              {index < STEPS.length - 1 && (
                <div
                  className="bg-border absolute top-4 left-[7px] w-px motion-safe:transition-all motion-safe:duration-300"
                  style={{ height: 'calc(100% - 1rem)' }}
                  aria-hidden="true"
                />
              )}

              <div
                className={cn(
                  'relative z-10 flex items-center gap-3 py-1.5',
                  'motion-safe:transition-all motion-safe:duration-300',
                )}
              >
                <div className="relative z-10">
                  <StepIndicator status={status} />
                </div>
                <span
                  className={cn(
                    'text-sm leading-6 font-medium',
                    status === 'pending' && 'text-muted-foreground',
                  )}
                >
                  {step.label}
                </span>
                {isCurrent && (
                  <ElapsedTimeBadge elapsedTime={elapsedMs} />
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </article>
  );
}
