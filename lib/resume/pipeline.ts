import type { RedesignProgressEvent, RedesignResultEvent } from '@/types/resume';
import { compareText } from './coverage';
import { extractPdfText } from './extract-text';
import { fixResumeTex, generateResumeTex } from './redesign';
import { suggestResumeFixes } from './suggestions';
import type { ResumeTemplate } from './templates';

const MAX_FIX_ATTEMPTS = 3;

export type CompileResult =
  | { ok: true; pdf: Uint8Array }
  | { ok: false; errors: string };

export type CompileFn = (
  tex: string,
  template: ResumeTemplate
) => Promise<CompileResult>;

export class ResumeCompileError extends Error {}

export type RedesignResult = Omit<RedesignResultEvent, 'pdf'> & { pdf: Uint8Array };

export async function runRedesign({
  pdf,
  sourceText,
  template,
  compile,
  onProgress,
  onCompileFailed,
}: {
  pdf: Uint8Array;
  sourceText: string;
  template: ResumeTemplate;
  compile: CompileFn;
  onProgress?: (event: RedesignProgressEvent) => void;
  onCompileFailed?: (attempt: number, tex: string, errors: string) => void;
}): Promise<RedesignResult> {
  onProgress?.({ step: 'writing' });
  let tex = await generateResumeTex(pdf, template);

  onProgress?.({ step: 'compiling' });
  let result = await compile(tex, template);
  for (let attempt = 1; !result.ok && attempt <= MAX_FIX_ATTEMPTS; attempt++) {
    onCompileFailed?.(attempt, tex, result.errors);
    onProgress?.({ step: 'fixing', attempt });
    tex = await fixResumeTex(tex, result.errors);
    result = await compile(tex, template);
  }
  if (!result.ok) {
    throw new ResumeCompileError(
      `Resume failed to compile after ${MAX_FIX_ATTEMPTS} fix attempts:\n${result.errors}`
    );
  }

  // Independent: the content check is fast, the suggestions call is an LLM round trip.
  onProgress?.({ step: 'checking' });
  const [coverage, suggestions] = await Promise.all([
    extractPdfText(result.pdf).then(({ text }) => {
      onProgress?.({ step: 'suggesting' });
      return compareText(sourceText, text);
    }),
    suggestResumeFixes(tex),
  ]);

  return { tex, pdf: result.pdf, coverage, suggestions };
}

// Pulls the error lines (plus a little context) out of a LaTeX log. Handles both
// "! Error" and -file-line-error style "./main.tex:93: Error".
const LATEX_ERROR_LINE = /^(!|\S*\.tex:\d+:)/;

export function extractLatexErrors(log: string): string {
  const lines = log.split(/\r?\n/);
  const errors = lines
    .flatMap((line, i) => (LATEX_ERROR_LINE.test(line) ? lines.slice(i, i + 6) : []))
    .join('\n');
  return errors || log.slice(-3000);
}
