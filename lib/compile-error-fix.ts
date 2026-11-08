import type { CompileErrorKind } from '@/lib/analytics/events';
import { classifyCompileError, countLatexErrors, isLatexErrorLine } from '@/lib/analytics/compile';
import type { CompilationError } from '@/types/compilation';

/**
 * "Fix with AI" on a failed compile: which failures get the offer, what the
 * button says, and the message sent to the agent. Pure, so it is unit tested
 * on its own (tests/unit/compile-error-fix.test.ts); the editor wiring is
 * hooks/use-compile-error-fix.ts.
 */

/** Upper bound on the error excerpt quoted in the message. */
export const ERROR_EXCERPT_MAX = 800;
/** At most this many distinct errors are quoted; later ones usually cascade from the first. */
export const ERROR_EXCERPT_MAX_ERRORS = 3;
/** How far below an error line its `l.<n>` line is looked for. */
const LINE_REF_LOOKAHEAD = 8;
const LINE_REF = /^l\.\d+/;

/**
 * Failures the AI cannot fix by editing the document: the compile service
 * was unreachable, busy or refused the token. Everything else (TeX errors,
 * timeouts from a runaway document, a rejected file) gets the offer.
 */
const NOT_FIXABLE: ReadonlySet<CompileErrorKind> = new Set([
  'network',
  'service_unavailable',
  'unauthorized',
]);

const KIND_LABELS: Partial<Record<CompileErrorKind, string>> = {
  missing_package: 'Missing package',
  undefined_control_sequence: 'Undefined command',
  missing_dollar: 'Math mode error',
  missing_brace: 'Unbalanced braces',
};

/** Short name of an error kind for the button, or null for the generic case. */
export function compileErrorKindLabel(kind: CompileErrorKind): string | null {
  return KIND_LABELS[kind] ?? null;
}

/** "Missing package — Fix with AI", or just "Fix with AI". */
export function compileErrorFixButtonLabel(kind: CompileErrorKind): string {
  const label = compileErrorKindLabel(kind);
  return label ? `${label} — Fix with AI` : 'Fix with AI';
}

function cutAt(text: string, max: number): string {
  if (text.length <= max) return text;
  // Never end on half a surrogate pair.
  const last = text.charCodeAt(max - 1);
  const end = last >= 0xd800 && last <= 0xdbff ? max - 1 : max;
  return `${text.slice(0, end)}…`;
}

/**
 * The first TeX errors of a log: each error line (`! ...` or
 * `<file>:<line>: ...`) followed by its `l.<n>` line when there is one,
 * repeated errors dropped, at most ERROR_EXCERPT_MAX_ERRORS of them and
 * `maxChars` characters. Whole errors are kept; only a single error longer
 * than the cap is cut. Empty when the log holds no TeX error line.
 */
export function extractLatexErrorExcerpt(
  log: string | undefined,
  maxChars: number = ERROR_EXCERPT_MAX
): string {
  if (!log) return '';
  const lines = log.split('\n').map((line) => line.trimEnd());
  const blocks: string[] = [];
  const seen = new Set<string>();

  for (let i = 0; i < lines.length && blocks.length < ERROR_EXCERPT_MAX_ERRORS; i += 1) {
    if (!isLatexErrorLine(lines[i])) continue;
    const block = [lines[i]];
    for (let j = i + 1; j < Math.min(lines.length, i + 1 + LINE_REF_LOOKAHEAD); j += 1) {
      if (isLatexErrorLine(lines[j])) break;
      if (LINE_REF.test(lines[j])) {
        block.push(lines[j].trim());
        break;
      }
    }
    const text = block.join('\n');
    if (seen.has(text)) continue;
    seen.add(text);
    blocks.push(text);
  }

  let excerpt = '';
  for (const block of blocks) {
    const next = excerpt ? `${excerpt}\n\n${block}` : block;
    if (next.length > maxChars) {
      if (!excerpt) excerpt = cutAt(block, maxChars);
      break;
    }
    excerpt = next;
  }
  return excerpt;
}

export interface CompileErrorFixOffer {
  kind: CompileErrorKind;
  /** Text of the action button. */
  buttonLabel: string;
  /** The message sent to the agent chat. */
  prompt: string;
  /** TeX error lines in the log (0 when no log came back). */
  errorCount: number;
}

/**
 * The message for the agent: the quoted errors (or, without a TeX error
 * line, the error message), the file that was compiled, and what to do.
 */
export function buildCompileErrorFixPrompt(
  error: Pick<CompilationError, 'message' | 'details' | 'log' | 'stdout' | 'stderr'>,
  fileName: string | null | undefined
): string {
  const log = error.log ?? error.stdout ?? error.stderr;
  const excerpt =
    extractLatexErrorExcerpt(log) ||
    cutAt((error.message || error.details || 'Compilation failed').trim(), ERROR_EXCERPT_MAX);
  const file = fileName ? ` (compiling ${fileName})` : '';
  return [
    `My document failed to compile${file}. The first error:`,
    '',
    '```',
    excerpt,
    '```',
    '',
    'Fix this error in the source and explain the change in one or two sentences.',
  ].join('\n');
}

/** The offer for one failed compile, or null when the AI cannot help. */
export function getCompileErrorFixOffer(
  error: CompilationError | null,
  fileName: string | null | undefined
): CompileErrorFixOffer | null {
  if (!error) return null;
  const kind = classifyCompileError(error, error.httpStatus);
  if (NOT_FIXABLE.has(kind)) return null;
  return {
    kind,
    buttonLabel: compileErrorFixButtonLabel(kind),
    prompt: buildCompileErrorFixPrompt(error, fileName),
    errorCount: countLatexErrors(error.log ?? error.stdout ?? error.stderr) ?? 0,
  };
}
