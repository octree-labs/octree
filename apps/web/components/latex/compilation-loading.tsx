'use client';

import { useState, useEffect, useRef } from 'react';
import { Check, Loader2 } from 'lucide-react';

const PHASES = [
  { label: 'Preparing files...' },
  { label: 'Running LaTeX engine...' },
  { label: 'Generating PDF...' },
];

// Time thresholds (ms) for each phase transition
const PHASE_THRESHOLDS = [0, 1000, 3000];

interface CompilationLoadingProps {
  completed?: boolean;
}

export function CompilationLoading({ completed = false }: CompilationLoadingProps) {
  const [elapsedMs, setElapsedMs] = useState(0);
  const startTimeRef = useRef(Date.now());

  // Elapsed timer
  useEffect(() => {
    const interval = setInterval(() => {
      setElapsedMs(Date.now() - startTimeRef.current);
    }, 100);
    return () => clearInterval(interval);
  }, []);

  const currentPhase = completed
    ? PHASES.length
    : PHASE_THRESHOLDS.reduce(
        (phase, threshold, i) => (elapsedMs >= threshold ? i : phase),
        0
      );

  const progressPercent = completed
    ? 100
    : Math.min(90, (1 - Math.exp(-elapsedMs / 4000)) * 100);

  const elapsedSeconds = Math.floor(elapsedMs / 1000);

  // Success state
  if (completed) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="flex items-center gap-2 animate-in fade-in duration-300">
          <div className="flex size-5 items-center justify-center rounded-full bg-primary">
            <Check className="size-3 text-white" strokeWidth={3} />
          </div>
          <span className="text-sm font-medium text-neutral-900">
            Compiled successfully
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full items-center justify-center">
      <div className="flex w-72 flex-col gap-4">
        {/* Phase steps */}
        <div className="flex flex-col gap-2">
          {PHASES.map((phase, i) => {
            const isDone = i < currentPhase;
            const isActive = i === currentPhase;
            return (
              <div key={i} className="flex items-center gap-2.5">
                {isDone ? (
                  <Check className="h-4 w-4 text-primary" />
                ) : isActive ? (
                  <Loader2 className="h-4 w-4 animate-spin text-primary" />
                ) : (
                  <div className="flex h-4 w-4 items-center justify-center">
                    <div className="h-1.5 w-1.5 rounded-full bg-slate-300" />
                  </div>
                )}
                <span
                  className={`text-sm ${
                    isDone
                      ? 'text-foreground'
                      : isActive
                        ? 'font-medium text-foreground'
                        : 'text-slate-400'
                  }`}
                >
                  {phase.label}
                </span>
              </div>
            );
          })}
        </div>

        {/* Progress bar */}
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-2">
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-200">
              <div
                className="h-full rounded-full bg-primary transition-all duration-300 ease-out"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
            <span className="text-xs tabular-nums text-slate-400">
              {Math.round(progressPercent)}%
            </span>
          </div>
          <p className="text-center text-xs text-slate-400">
            {elapsedSeconds}s elapsed
          </p>
        </div>
      </div>
    </div>
  );
}
