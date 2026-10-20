import type { CompileErrorKind } from '@/lib/analytics/events';
import type { CompilationError } from '@/types/compilation';

/**
 * Pure helpers behind `compile_completed` (hooks/use-editor-compilation.ts):
 * which failures get which `error_kind`, what the error summary is, and
 * whether a given compile is captured or sampled out. No PostHog, no DOM,
 * so they are unit tested on their own.
 */

/** Successful compiles after the first FIRST_COMPILES_UNSAMPLED are captured 1 in N. */
export const COMPILE_SUCCESS_SAMPLE_RATE = 10;
/**
 * The first successes on a browser are never sampled out, so "did this
 * user's first compile succeed?" can be read from the events.
 */
export const FIRST_COMPILES_UNSAMPLED = 5;
/** localStorage key holding the browser's successful compile count. */
export const SUCCESSFUL_COMPILE_COUNT_KEY = 'octree.analytics.successful_compile_count';

const ERROR_SUMMARY_MAX = 200;

/** The first TeX error line (`! ...`) in a log, if any. */
export function firstLatexErrorLine(log: string | undefined): string | undefined {
  if (!log) return undefined;
  for (const raw of log.split('\n')) {
    const line = raw.trimEnd();
    if (line.startsWith('! ')) return line;
  }
  return undefined;
}

/** How many `! ` error lines a log holds. */
export function countLatexErrors(log: string | undefined): number | undefined {
  if (!log) return undefined;
  let count = 0;
  for (const line of log.split('\n')) {
    if (line.startsWith('! ')) count += 1;
  }
  return count;
}

function truncate(text: string): string {
  const trimmed = text.trim();
  return trimmed.length > ERROR_SUMMARY_MAX ? trimmed.slice(0, ERROR_SUMMARY_MAX) : trimmed;
}

/**
 * Buckets a failure. Transport failures are told apart by HTTP status first
 * (a 408 or 503 carries no TeX log); everything else goes by the first `! `
 * line, or the error message when there is no log.
 */
export function classifyCompileError(
  error: Pick<CompilationError, 'message' | 'log' | 'stdout' | 'stderr'> | null,
  httpStatus?: number
): CompileErrorKind {
  if (httpStatus === 408 || httpStatus === 504) return 'timeout';
  if (httpStatus === 401 || httpStatus === 403) return 'unauthorized';
  if (httpStatus === 502 || httpStatus === 503 || httpStatus === 429) return 'service_unavailable';

  const summary = firstLatexErrorLine(error?.log ?? error?.stdout ?? error?.stderr);
  const text = summary ?? error?.message ?? '';

  if (/undefined control sequence/i.test(text)) return 'undefined_control_sequence';
  if (/file `[^']*\.(sty|cls)' not found/i.test(text)) return 'missing_package';
  if (/missing \$ inserted/i.test(text)) return 'missing_dollar';
  if (/missing [{}] inserted|too many }'s|extra }, or forgotten/i.test(text)) return 'missing_brace';
  if (summary) return 'latex_error';

  // No TeX error line: a message from the relay, fetch or the hook itself.
  if (/timed out|timeout/i.test(text)) return 'timeout';
  if (/failed to fetch|networkerror|network request failed|load failed|not configured/i.test(text)) {
    return 'network';
  }
  if (/service unavailable|unavailable|too busy|queue is full|bad gateway/i.test(text)) {
    return 'service_unavailable';
  }
  if (/unauthori[sz]ed|invalid or expired token|authorization header/i.test(text)) {
    return 'unauthorized';
  }
  return 'latex_error';
}

export interface CompileFailureProperties {
  error_kind: CompileErrorKind;
  error_summary?: string;
  error_count?: number;
  http_status?: number;
}

/** The failure properties of `compile_completed` for one error. */
export function describeCompileFailure(
  error: CompilationError | null,
  httpStatus?: number
): CompileFailureProperties {
  const log = error?.log ?? error?.stdout ?? error?.stderr;
  const firstLine = firstLatexErrorLine(log);
  const fallback = error?.message || error?.details;
  const summary = firstLine ?? fallback;
  const props: CompileFailureProperties = {
    error_kind: classifyCompileError(error, httpStatus),
  };
  if (summary) props.error_summary = truncate(summary);
  const count = countLatexErrors(log);
  if (count !== undefined) props.error_count = count;
  if (typeof httpStatus === 'number' && httpStatus > 0) props.http_status = httpStatus;
  return props;
}

export interface CompileSamplingDecision {
  /** Whether to send the event at all. */
  capture: boolean;
  /** 1 when `capture` was not a sample; otherwise the N of "1 in N". */
  sample_rate: number;
  /** See `compile_completed.compile_index` in lib/analytics/events.ts. */
  compile_index: number | null;
}

/**
 * Whether one compile is captured. `successesBefore` is the browser's
 * successful compile count before this compile, or `null` when storage was
 * unavailable (then the first-compile exemption cannot be applied and the
 * plain 1-in-N sampling is used). `sampler(rate)` decides a sampled capture;
 * it is injected so the decision is deterministic in tests.
 */
export function decideCompileSampling(
  success: boolean,
  successesBefore: number | null,
  sampler: (rate: number) => boolean
): CompileSamplingDecision {
  if (!success) {
    return { capture: true, sample_rate: 1, compile_index: successesBefore };
  }
  if (successesBefore !== null && successesBefore < FIRST_COMPILES_UNSAMPLED) {
    return { capture: true, sample_rate: 1, compile_index: successesBefore + 1 };
  }
  return {
    capture: sampler(COMPILE_SUCCESS_SAMPLE_RATE),
    sample_rate: COMPILE_SUCCESS_SAMPLE_RATE,
    compile_index: successesBefore === null ? null : successesBefore + 1,
  };
}

function storage(): Storage | null {
  try {
    return typeof window !== 'undefined' && window.localStorage ? window.localStorage : null;
  } catch {
    return null;
  }
}

/** The browser's successful compile count, or `null` when storage is unavailable or unreadable. */
export function readSuccessfulCompileCount(): number | null {
  try {
    const store = storage();
    if (!store) return null;
    const raw = store.getItem(SUCCESSFUL_COMPILE_COUNT_KEY);
    if (raw === null) return 0;
    const parsed = Number.parseInt(raw, 10);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
  } catch {
    return null;
  }
}

/** Records one more successful compile; silently does nothing without storage. */
export function writeSuccessfulCompileCount(count: number): void {
  try {
    storage()?.setItem(SUCCESSFUL_COMPILE_COUNT_KEY, String(count));
  } catch {
    // Private mode, quota, blocked storage: the next compile falls back to sampling.
  }
}
