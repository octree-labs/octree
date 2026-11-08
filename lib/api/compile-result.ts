import type { CompileErrorKind } from '@/lib/analytics/events';
import { classifyCompileError } from '@/lib/analytics/compile';
import type { CompilerResponse } from '@/app/api/compile-pdf/types';

/**
 * Shapes a compile service answer (app/api/compile-pdf/compiler.ts
 * `compileLatex`) into the public API's JSON. A LaTeX failure is a
 * successful API call (`ok: false`, HTTP 200); request, auth, quota and
 * service problems are not results at all (see `classifyServiceFailure`).
 */

export interface ApiCompileError {
  /** Source file of the error, when the log names one (`main.tex`). */
  file: string | null;
  /** 1-based line, when the log names one. */
  line: number | null;
  message: string;
  kind: ApiErrorKind;
}

export interface ApiCompileSuccess {
  ok: true;
  pdf_base64: string;
  pages?: number;
  duration_ms: number;
  warnings: string[];
  log_tail: string;
}

export interface ApiCompileFailure {
  ok: false;
  errors: ApiCompileError[];
  log_tail: string;
  suggestion?: string;
  duration_ms: number;
}

export type ApiCompileJson = ApiCompileSuccess | ApiCompileFailure;

export const MAX_REPORTED_ERRORS = 20;
export const MAX_REPORTED_WARNINGS = 20;
export const LOG_TAIL_CHARS = 4000;

const TMP_PATH_RE = /\/tmp\/latex-[^/\s]+\//g;
/** `-file-line-error` form: `./main.tex:12: Undefined control sequence.` */
const FILE_LINE_RE = /^(?:\.{1,2}\/)?([^\s:()[\]]+\.[A-Za-z]{1,4}):(\d+): (.+)$/;
const WARNING_RE = /^(?:LaTeX|Package [^\s]+|Class [^\s]+|pdfTeX) warning/i;

function cleanLog(log: string): string {
  return log.replace(/\r\n?/g, '\n').replace(TMP_PATH_RE, './');
}

function stripDotSlash(file: string): string {
  return file.replace(/^\.\//, '');
}

/** The public error kinds: always one of the five TeX buckets, never a transport kind. */
export type ApiErrorKind = Extract<
  CompileErrorKind,
  'missing_package' | 'undefined_control_sequence' | 'missing_dollar' | 'missing_brace' | 'latex_error'
>;

/** Classified as a TeX error line (lib/analytics/compile.ts), so the answer is a TeX bucket. */
function kindOf(message: string): ApiErrorKind {
  return classifyCompileError({ message, log: `! ${message}` }) as ApiErrorKind;
}

/**
 * The TeX errors in a log, in order: `<file>:<line>: <message>` lines and
 * `! <message>` lines (whose line number comes from the following `l.<n>`
 * context line). Duplicates collapse; at most MAX_REPORTED_ERRORS.
 */
export function parseLatexErrors(rawLog: string | undefined): ApiCompileError[] {
  if (!rawLog) return [];
  const lines = cleanLog(rawLog).split('\n');
  const errors: ApiCompileError[] = [];
  const seen = new Set<string>();

  const push = (error: ApiCompileError) => {
    const key = `${error.file}:${error.line}:${error.message}`;
    if (seen.has(key)) return;
    seen.add(key);
    errors.push(error);
  };

  for (let i = 0; i < lines.length && errors.length < MAX_REPORTED_ERRORS; i++) {
    const line = lines[i].trimEnd();
    const fileLine = FILE_LINE_RE.exec(line);
    if (fileLine) {
      const message = fileLine[3].trim();
      push({ file: stripDotSlash(fileLine[1]), line: Number(fileLine[2]), message, kind: kindOf(message) });
      continue;
    }
    if (line.startsWith('! ')) {
      const message = line.slice(2).trim();
      let lineNo: number | null = null;
      for (let j = i + 1; j < Math.min(lines.length, i + 12); j++) {
        const ctx = /^l\.(\d+)/.exec(lines[j]);
        if (ctx) {
          lineNo = Number(ctx[1]);
          break;
        }
        if (lines[j].startsWith('! ') || FILE_LINE_RE.test(lines[j])) break;
      }
      push({ file: null, line: lineNo, message, kind: kindOf(message) });
    }
  }
  return errors;
}

/** `LaTeX Warning: ...`, `Package x Warning: ...` lines of a log (at most MAX_REPORTED_WARNINGS). */
export function parseLatexWarnings(rawLog: string | undefined): string[] {
  if (!rawLog) return [];
  const out: string[] = [];
  for (const raw of cleanLog(rawLog).split('\n')) {
    const line = raw.trim();
    if (WARNING_RE.test(line) && !out.includes(line)) out.push(line);
    if (out.length >= MAX_REPORTED_WARNINGS) break;
  }
  return out;
}

/** The last LOG_TAIL_CHARS characters of a log, temp paths stripped. */
export function logTail(rawLog: string | undefined): string {
  if (!rawLog) return '';
  const log = cleanLog(rawLog).trimEnd();
  return log.length <= LOG_TAIL_CHARS ? log : log.slice(log.length - LOG_TAIL_CHARS);
}

const SUGGESTIONS: Partial<Record<CompileErrorKind, string>> = {
  missing_package:
    'A package or class is not installed on the compile server. Remove it or switch to a standard TeX Live package.',
  undefined_control_sequence:
    'A command is not defined. Check its spelling, or add the \\usepackage that provides it.',
  missing_dollar: 'A math-only command or character is used outside math mode. Wrap it in $...$ or escape it (e.g. \\_).',
  missing_brace: 'Braces are unbalanced near the reported line. Check every { has a matching }.',
};

/** How a compile service answer is handled by the API. */
export type ServiceFailureKind = 'latex' | 'invalid_request' | 'timeout' | 'unavailable';

/**
 * A LaTeX failure is the compile service's 500 "LaTeX compilation failed"
 * (with a log). 400/413 are requests the service refused (e.g. a shell
 * escape package it does not support), the relay's own abort is a timeout,
 * and everything else (busy, auth, network) is the service being unavailable.
 */
export function classifyServiceFailure(error: CompilerResponse['error']): ServiceFailureKind {
  if (!error) return 'unavailable';
  if (error.timedOut) return 'timeout';
  const status = error.status;
  if (status === 400 || status === 413 || status === 422) return 'invalid_request';
  if (status === 500) return 'latex';
  return 'unavailable';
}

/** The `ok: false` body for a LaTeX failure. */
export function buildCompileFailure(error: NonNullable<CompilerResponse['error']>, durationMs: number): ApiCompileFailure {
  const log = error.log || error.stdout || error.stderr || '';
  let errors = parseLatexErrors(log);
  if (errors.length === 0) {
    const message = (error.details || error.error || 'LaTeX compilation failed').trim();
    errors = [{ file: null, line: null, message, kind: kindOf(message) }];
  }
  const suggestion = SUGGESTIONS[errors[0].kind] ?? error.suggestion;
  const failure: ApiCompileFailure = {
    ok: false,
    errors,
    log_tail: logTail(log),
    duration_ms: durationMs,
  };
  if (suggestion) failure.suggestion = suggestion;
  return failure;
}

/**
 * The `ok: true` body. The compile service returns only the PDF on success
 * (no log), so `warnings` is empty and `log_tail` is '' for now.
 */
export function buildCompileSuccess(pdfBase64: string, durationMs: number, pages?: number | null): ApiCompileSuccess {
  const success: ApiCompileSuccess = {
    ok: true,
    pdf_base64: pdfBase64,
    duration_ms: durationMs,
    warnings: [],
    log_tail: '',
  };
  if (typeof pages === 'number' && pages > 0) success.pages = pages;
  return success;
}

/** Page count of a PDF, or undefined when it cannot be read. */
export async function countPdfPages(pdf: Uint8Array): Promise<number | undefined> {
  try {
    const { getDocumentProxy } = await import('unpdf');
    const doc = await getDocumentProxy(new Uint8Array(pdf));
    const pages = doc.numPages;
    await doc.cleanup?.();
    return pages;
  } catch {
    return undefined;
  }
}
