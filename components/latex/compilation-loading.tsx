'use client';

import { useState, useEffect, useRef } from 'react';
import { Check, CircleCheck, Loader2 } from 'lucide-react';

const TIPS = [
  'Use \\usepackage{hyperref} to make URLs and cross-references clickable in your PDF.',
  'Use a non-breaking space ~ before \\cite{} and \\ref{} to prevent awkward line breaks.',
  'Define reusable commands with \\newcommand{\\name}[args]{definition} to keep your code DRY.',
  'Prefer \\usepackage{booktabs} with \\toprule, \\midrule, \\bottomrule for professional tables.',
  'Use \\includegraphics[width=\\textwidth]{file} to scale images to the column width.',
  'Set page margins easily with \\usepackage[margin=1in]{geometry}.',
  'Wrap math in \\ensuremath{} inside commands so they work in both text and math mode.',
  'Load \\usepackage{microtype} for subtle spacing improvements that make text look polished.',
  'Use \\phantom{text} to reserve space without displaying anything — great for alignment.',
  'Try \\usepackage{cleveref} — \\cref{fig:x} auto-inserts "Figure", "Table", etc.',
  'Always use the figure environment with \\caption and \\label for numbered, referenceable figures.',
  'Format units with \\usepackage{siunitx} — e.g., \\SI{9.8}{m/s^2} for consistent notation.',
  'Use \\vspace*{} instead of \\vspace{} to ensure spacing is not removed at page breaks.',
  'Switch to \\raggedright in narrow columns to avoid ugly word spacing from justification.',
  'Add \\listoffigures and \\listoftables after \\tableofcontents for a complete document outline.',
];

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
  const [tipIndex, setTipIndex] = useState(() => Math.floor(Math.random() * TIPS.length));
  const [tipVisible, setTipVisible] = useState(true);
  const startTimeRef = useRef(Date.now());
  const tipIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Elapsed timer
  useEffect(() => {
    const interval = setInterval(() => {
      setElapsedMs(Date.now() - startTimeRef.current);
    }, 100);
    return () => clearInterval(interval);
  }, []);

  // Tip rotation: fade out, swap, fade in every 4s
  useEffect(() => {
    tipIntervalRef.current = setInterval(() => {
      setTipVisible(false);
      setTimeout(() => {
        setTipIndex((prev) => (prev + 1) % TIPS.length);
        setTipVisible(true);
      }, 300);
    }, 4000);
    return () => {
      if (tipIntervalRef.current) clearInterval(tipIntervalRef.current);
    };
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
        <div className="flex flex-col items-center gap-2 animate-in fade-in duration-300">
          <CircleCheck className="h-8 w-8 text-green-500" />
          <span className="text-sm font-medium text-green-600">
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
                  <Check className="h-4 w-4 text-green-500" />
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
                      ? 'text-green-600'
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

        {/* Divider + tip */}
        <div className="flex flex-col gap-3">
          <div className="h-px bg-slate-200" />
          <p
            className="text-center text-xs leading-relaxed text-slate-500 transition-opacity duration-300"
            style={{ opacity: tipVisible ? 1 : 0 }}
          >
            <span className="mr-1">💡</span>
            {TIPS[tipIndex]}
          </p>
        </div>
      </div>
    </div>
  );
}
