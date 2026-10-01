'use client';

import { useEffect, useState } from 'react';
import { Check, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ResumeTemplateOption } from '@/lib/resume/template-options';
import type { RedesignProgressEvent, RedesignStep } from '@/types/resume';

const STEPS: { step: RedesignStep; label: string }[] = [
  { step: 'reading', label: 'Reading your resume' },
  { step: 'writing', label: 'Writing it into the template' },
  { step: 'compiling', label: 'Compiling the PDF' },
  { step: 'checking', label: 'Checking nothing was lost' },
  { step: 'suggesting', label: 'Looking for fixes' },
];

// 'fixing' is shown as part of the compile step.
function stepIndex(step: RedesignStep): number {
  return STEPS.findIndex((s) => s.step === (step === 'fixing' ? 'compiling' : step));
}

function useElapsedSeconds() {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    const start = Date.now();
    const id = setInterval(() => setSeconds(Math.floor((Date.now() - start) / 1000)), 1000);
    return () => clearInterval(id);
  }, []);
  return seconds;
}

export function RedesignProgress({
  progress,
  template,
}: {
  progress: RedesignProgressEvent | null;
  template?: ResumeTemplateOption;
}) {
  const current = progress ? stepIndex(progress.step) : -1;
  const elapsed = useElapsedSeconds();
  // Count the active step as half done so the bar moves as soon as work starts.
  const percent = Math.round(((Math.max(current, 0) + 0.5) / STEPS.length) * 100);

  return (
    <div className="grid h-full items-center gap-10 md:grid-cols-2">
      <div>
        <ol>
          {STEPS.map(({ step, label }, i) => {
            const done = i < current;
            const active = i === current;
            const last = i === STEPS.length - 1;
            return (
              <li key={step} className="flex gap-3">
                <div className="flex flex-col items-center">
                  <span
                    className={cn(
                      'mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full',
                      done && 'bg-primary text-primary-foreground',
                      active && 'text-primary', // in progress: bare spinner, no circle
                      !done && !active && 'bg-neutral-100'
                    )}
                  >
                    {done ? (
                      <Check className="size-2.5" strokeWidth={3} />
                    ) : active ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : null}
                  </span>
                  {!last && (
                    <span
                      className={cn('my-1 w-px flex-1', done ? 'bg-primary/30' : 'bg-neutral-100')}
                    />
                  )}
                </div>
                <div className={cn(!last && 'pb-5')}>
                  <p
                    className={cn(
                      'text-sm',
                      active && 'font-medium text-neutral-900',
                      done && 'text-neutral-700',
                      !done && !active && 'text-neutral-400'
                    )}
                  >
                    {label}
                  </p>
                  {active && progress?.step === 'fixing' && (
                    <p className="text-xs text-neutral-500">
                      Fixing compile errors (attempt {progress.attempt})
                    </p>
                  )}
                </div>
              </li>
            );
          })}
        </ol>

        <div className="mt-6 space-y-2">
          <div className="h-1.5 overflow-hidden rounded-full bg-neutral-100">
            <div
              className="h-full rounded-full bg-primary transition-[width] duration-500"
              style={{ width: `${percent}%` }}
            />
          </div>
          <div className="flex justify-between text-xs text-neutral-400">
            <span>This usually takes 20-40 seconds</span>
            <span className="tabular-nums">{elapsed}s</span>
          </div>
        </div>
      </div>

      {template && (
        <div className="hidden md:block">
          <div className="relative aspect-[4/3] overflow-hidden rounded-xl border bg-white shadow-sm">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={template.thumbnail}
              alt=""
              className="h-full w-full object-cover object-top opacity-60"
            />
            <div className="absolute inset-0 animate-pulse bg-gradient-to-b from-white/0 via-white/50 to-white" />
          </div>
          <p className="mt-3 text-center text-xs text-neutral-500">
            Building your resume in the{' '}
            <span className="font-medium text-neutral-700">{template.name}</span> template
          </p>
        </div>
      )}
    </div>
  );
}
