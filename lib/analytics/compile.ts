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

/**
 * `-file-line-error` form of a TeX error, which the compile service asks for
 * (services/compile/internal/compiler.go): `./main.tex:12: Undefined control
 * sequence.` instead of `! Undefined control sequence.`
 */
const FILE_LINE_ERROR = /^(?:\.{1,2}\/)?[^\s:()[\]]+\.[A-Za-z]{1,4}:\d+: \S/;

/** Whether one log line starts a TeX error: `! ...` or `<file>:<line>: ...`. */
export function isLatexErrorLine(line: string): boolean {
  return line.startsWith('! ') || FILE_LINE_ERROR.test(line);
}

const EMERGENCY_STOP = /^! Emergency stop\.?$/;
/** TeX's note after an emergency stop, e.g. `*** (job aborted, no legal \end found)`. */
const ABORT_NOTE = /^\*\*\* \(/;
const ABORT_NOTE_LOOKAHEAD = 8;

/**
 * The first TeX error line (`! ...` or `<file>:<line>: ...`) in a log, if any.
 * `! Emergency stop.` only says that TeX gave up, so a different error line
 * wins over it even when it comes later; when it is the only one, the abort
 * note TeX prints just below it (`*** (job aborted, no legal \end found)`)
 * is appended, since that is the actual cause.
 */
export function firstLatexErrorLine(log: string | undefined): string | undefined {
  if (!log) return undefined;
  const lines = log.split('\n').map((raw) => raw.trimEnd());
  let emergency: number | undefined;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (!isLatexErrorLine(line)) continue;
    if (EMERGENCY_STOP.test(line)) {
      if (emergency === undefined) emergency = i;
      continue;
    }
    return line;
  }
  if (emergency === undefined) return undefined;
  const end = Math.min(lines.length, emergency + 1 + ABORT_NOTE_LOOKAHEAD);
  for (let j = emergency + 1; j < end; j += 1) {
    if (ABORT_NOTE.test(lines[j])) return `${lines[emergency]} ${lines[j].trim()}`;
  }
  return lines[emergency];
}

type CompileErrorTexts = Pick<CompilationError, 'log' | 'stdout' | 'stderr'>;

/** The log, stdout and stderr of a failure, in the order they are searched. */
function errorTexts(error: CompileErrorTexts | null | undefined): string[] {
  return [error?.log, error?.stdout, error?.stderr].filter((text): text is string => !!text);
}

/**
 * The first TeX error line across the log, then stdout, then stderr. The
 * compile service sends the log's tail, which holds no error line when the
 * error happened early in a long run; latexmk's own output (stdout) often
 * still has it.
 */
export function firstLatexErrorLineOf(error: CompileErrorTexts | null | undefined): string | undefined {
  for (const text of errorTexts(error)) {
    const line = firstLatexErrorLine(text);
    if (line) return line;
  }
  return undefined;
}

/**
 * Messages the client or the compile service use for any failure; they say
 * nothing about the cause, so the details line is preferred over them.
 */
const GENERIC_MESSAGE = /^(LaTeX compilation failed|Compilation failed with status \d+)$/;

/** The message of a failure, or its details when the message is the generic one. */
export function compileFailureMessage(
  error: Pick<CompilationError, 'message' | 'details'> | null | undefined
): string | undefined {
  if (!error) return undefined;
  if (error.details && (!error.message || GENERIC_MESSAGE.test(error.message))) return error.details;
  return error.message || error.details;
}

/** How many TeX error lines (`! ` or `<file>:<line>: `) a log holds. */
export function countLatexErrors(log: string | undefined): number | undefined {
  if (!log) return undefined;
  let count = 0;
  for (const line of log.split('\n')) {
    if (isLatexErrorLine(line)) count += 1;
  }
  return count;
}

function truncate(text: string): string {
  const trimmed = text.trim();
  if (trimmed.length <= ERROR_SUMMARY_MAX) return trimmed;
  // Never cut a surrogate pair in half (an emoji or a CJK extension glyph
  // in the offending line would otherwise end the summary with U+FFFD).
  const last = trimmed.charCodeAt(ERROR_SUMMARY_MAX - 1);
  const end = last >= 0xd800 && last <= 0xdbff ? ERROR_SUMMARY_MAX - 1 : ERROR_SUMMARY_MAX;
  return trimmed.slice(0, end);
}

/**
 * Buckets a failure. Transport failures are told apart by HTTP status first
 * (a 408 or 503 carries no TeX log); everything else goes by the first `! `
 * line of the log (then stdout, then stderr), or the error message and
 * details when none of them holds one. The first
 * error line wins because later ones usually cascade from it (a missing
 * package's macros come back as undefined control sequences).
 */
export function classifyCompileError(
  error: Pick<CompilationError, 'message' | 'details' | 'log' | 'stdout' | 'stderr'> | null,
  httpStatus?: number
): CompileErrorKind {
  if (httpStatus === 408 || httpStatus === 504) return 'timeout';
  if (httpStatus === 401 || httpStatus === 403) return 'unauthorized';
  if (httpStatus === 502 || httpStatus === 503 || httpStatus === 429) return 'service_unavailable';
  if (httpStatus === 400 || httpStatus === 413 || httpStatus === 422) return 'request_rejected';

  const summary = firstLatexErrorLineOf(error);
  const text = summary ?? [error?.message, error?.details].filter(Boolean).join(' ');

  if (/undefined control sequence/i.test(text)) return 'undefined_control_sequence';
  if (/file [`'][^']*\.(sty|cls)' not found/i.test(text)) return 'missing_package';
  if (/missing \$ inserted/i.test(text)) return 'missing_dollar';
  if (/missing [{}] inserted|too many }'s|extra }, or forgotten/i.test(text)) return 'missing_brace';
  if (summary) return 'latex_error';

  // No TeX error line: a message from the relay, fetch or the hook itself.
  if (/timed out|timeout/i.test(text)) return 'timeout';
  if (
    /failed to fetch|networkerror|network request failed|load failed|not configured|no pdf data|empty response/i.test(
      text
    )
  ) {
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
  const firstLine = firstLatexErrorLineOf(error);
  const summary = firstLine ?? compileFailureMessage(error);
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
