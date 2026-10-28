import type { AtsReport } from '@/types/resume';
import { extractPdfText } from '../extract-text';
import { reviewResumeContent, scoreIssues } from './content-review';
import { matchJobDescription } from './job-match';
import { runParseChecks, scoreChecks } from './parse-checks';

export const MAX_JOB_DESCRIPTION_CHARS = 20_000;
const MAX_PAGES = 5;

/** A problem with the input whose message is safe to show the user. */
export class AtsInputError extends Error {}

/**
 * Overall score weights. With a job description the match dominates, since
 * that is what an ATS actually ranks on; without one, the score is how well
 * the resume parses plus how strong the content is.
 */
const WEIGHTS = {
  withJob: { parsing: 0.35, content: 0.25, jobMatch: 0.4 },
  withoutJob: { parsing: 0.55, content: 0.45 },
} as const;

export function overallScore(scores: AtsReport['scores']): number {
  if (scores.jobMatch === null) {
    const w = WEIGHTS.withoutJob;
    return Math.round(scores.parsing * w.parsing + scores.content * w.content);
  }
  const w = WEIGHTS.withJob;
  return Math.round(scores.parsing * w.parsing + scores.content * w.content + scores.jobMatch * w.jobMatch);
}

/**
 * Analyzes a compiled resume: deterministic checks on the text extracted from
 * the PDF, an AI content review of the LaTeX, and, when a job description is
 * given, keyword matching against it. The two AI calls run in parallel.
 */
export async function analyzeResume({
  tex,
  pdf,
  jobDescription,
}: {
  tex: string;
  pdf: Uint8Array;
  jobDescription?: string | null;
}): Promise<AtsReport> {
  const { text, totalPages } = await extractPdfText(pdf);
  if (totalPages > MAX_PAGES) {
    throw new AtsInputError(`This PDF has ${totalPages} pages. Resumes up to ${MAX_PAGES} pages are supported.`);
  }
  if (!text.trim()) {
    throw new AtsInputError('No text could be read from the compiled PDF.');
  }
  const job = jobDescription?.trim().slice(0, MAX_JOB_DESCRIPTION_CHARS);

  const checks = runParseChecks(text, totalPages);
  const [issues, jobMatch] = await Promise.all([
    reviewResumeContent(tex),
    job ? matchJobDescription(text, job) : Promise.resolve(null),
  ]);

  const scores = {
    parsing: scoreChecks(checks),
    content: scoreIssues(issues),
    jobMatch: jobMatch?.score ?? null,
  };
  return { score: overallScore(scores), scores, checks, issues, jobMatch };
}
