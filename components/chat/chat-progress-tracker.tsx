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
        className="flex size-4 shrink-0 items-center justify-center rounded-full border border-slate-300 bg-white"
        aria-hidden="true"
      />
    );
  }

  if (status === 'in-progress') {
    return (
      <span
        className="flex size-4 shrink-0 items-center justify-center rounded-full border border-blue-200 bg-white shadow-[0_0_0_3px_hsl(var(--primary)/0.1)]"
        aria-hidden="true"
      >
        <Loader2 className="size-3.5 text-blue-600 animate-spin" />
      </span>
    );
  }

  return (
    <span
      className="flex size-4 shrink-0 items-center justify-center rounded-full border border-blue-600 bg-blue-600 shadow-sm"
      aria-hidden="true"
    >
      <Check className="size-2.5 text-white" strokeWidth={3} />
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
    <div className="flex items-center gap-1 font-mono text-[11px] text-slate-500">
      <Timer className="-mt-px size-3" />
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
        'select-none text-slate-700',
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
                  className="absolute top-4 left-[7px] w-px bg-slate-200 transition-all duration-300"
                  style={{ height: 'calc(100% - 1rem)' }}
                  aria-hidden="true"
                />
              )}

              <div
                className={cn(
                  'relative z-10 flex items-center gap-2 py-1',
                  'transition-all duration-300',
                )}
              >
                <div className="relative z-10">
                  <StepIndicator status={status} />
                </div>
                <span
                  className={cn(
                    'text-xs leading-5 font-medium',
                    status === 'pending' && 'text-slate-400',
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
