'use client';

import { Check, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
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

export function RedesignProgress({
  fileName,
  progress,
}: {
  fileName: string;
  progress: RedesignProgressEvent | null;
}) {
  const current = progress ? stepIndex(progress.step) : -1;

  return (
    <div>
      <p className="mb-5 truncate text-sm text-neutral-500">{fileName}</p>
      <ol className="space-y-3">
        {STEPS.map(({ step, label }, i) => {
          const done = i < current;
          const active = i === current;
          return (
            <li key={step} className="flex items-center gap-3 text-sm">
              <span className="flex size-5 items-center justify-center">
                {done ? (
                  <Check className="size-4 text-green-600" />
                ) : active ? (
                  <Loader2 className="size-4 animate-spin text-primary" />
                ) : (
                  <span className="size-1.5 rounded-full bg-neutral-300" />
                )}
              </span>
              <span className={cn(done || active ? 'text-neutral-900' : 'text-neutral-400')}>
                {label}
                {active && progress?.step === 'fixing' && (
                  <span className="text-neutral-500">
                    {' '}(fixing errors, attempt {progress.attempt})
                  </span>
                )}
              </span>
            </li>
          );
        })}
      </ol>
      <p className="mt-5 text-xs text-neutral-400">This usually takes 20-40 seconds.</p>
    </div>
  );
}
