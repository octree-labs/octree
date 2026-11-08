'use client';

import { useCallback, useEffect, useMemo, useRef } from 'react';
import { COMPILE_ERROR_FIX_ENABLED } from '@/data/constants';
import { AnalyticsEvents, type CompileErrorFixProperties } from '@/lib/analytics/events';
import { readSuccessfulCompileCount } from '@/lib/analytics/compile';
import { track } from '@/lib/analytics/track';
import { getCompileErrorFixOffer, type CompileErrorFixOffer } from '@/lib/compile-error-fix';
import type { CompilationError } from '@/types/compilation';

interface UseCompileErrorFixOptions {
  /** The failed compile's error; null while there is none. */
  compilationError: CompilationError | null;
  /** The file open in the editor (named in the message; not necessarily the compiled one). */
  fileName: string | null | undefined;
  /** Opens the chat and sends `prompt` as an AI edit. */
  onSend: (prompt: string) => void;
  /** Defaults to COMPILE_ERROR_FIX_ENABLED; injectable for tests. */
  enabled?: boolean;
}

export interface CompileErrorFixState {
  /** The offer for the current error, or null (no error, switched off, not fixable). */
  offer: CompileErrorFixOffer | null;
  /** The button: sends the prompt once per failed compile. */
  fix: () => void;
}

/**
 * "Fix with AI" on a failed compile. Each failed compile produces a new
 * error object, so the error's identity is the compile: `shown` is captured
 * once per error however often the panel re-renders, and a second click on
 * the same error (double click, the bar and the overlay both mounted) sends
 * nothing.
 */
export function useCompileErrorFix({
  compilationError,
  fileName,
  onSend,
  enabled = COMPILE_ERROR_FIX_ENABLED,
}: UseCompileErrorFixOptions): CompileErrorFixState {
  const offer = useMemo(
    () => (enabled ? getCompileErrorFixOffer(compilationError, fileName) : null),
    [enabled, compilationError, fileName]
  );

  const shownFor = useRef<CompilationError | null>(null);
  const clickedFor = useRef<CompilationError | null>(null);

  const properties = useCallback(
    (current: CompileErrorFixOffer): CompileErrorFixProperties => ({
      error_kind: current.kind,
      error_count: current.errorCount,
      compile_index: readSuccessfulCompileCount(),
    }),
    []
  );

  useEffect(() => {
    if (!offer || !compilationError || shownFor.current === compilationError) return;
    shownFor.current = compilationError;
    track(AnalyticsEvents.COMPILE_ERROR_FIX_SHOWN, properties(offer));
  }, [offer, compilationError, properties]);

  const fix = useCallback(() => {
    if (!offer || !compilationError || clickedFor.current === compilationError) return;
    clickedFor.current = compilationError;
    track(AnalyticsEvents.COMPILE_ERROR_FIX_CLICKED, properties(offer));
    onSend(offer.prompt);
  }, [offer, compilationError, properties, onSend]);

  return { offer, fix };
}
