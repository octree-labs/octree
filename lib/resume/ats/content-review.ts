import { anthropic } from '@ai-sdk/anthropic';
import { generateObject } from 'ai';
import { z } from 'zod';
import type { AtsIssue } from '@/types/resume';
import { RESUME_MODEL } from '../redesign';

const REVIEW_PROMPT = `You review a resume, given as LaTeX source, the way a recruiter screening for an ATS-ranked shortlist would. Point out the problems that most weaken it.

Categories:
- impact: bullets that list duties instead of results, weak openers ("Responsible for", "Helped with", "Worked on"), achievements with no scale or outcome
- clarity: bullets over two lines, vague wording, unexplained internal jargon or acronyms
- consistency: mixed tenses within a role, inconsistent bullet style across roles
- length: sections that are too thin or padded

Severity: "high" for problems a recruiter would notice in a six-second skim, "medium" for clear weaknesses, "low" for polish.

Rules:
- Never invent facts. Do not add numbers, metrics, technologies, titles, or outcomes that are not already in the resume. When a bullet needs a metric only the candidate knows, explain that in "reason" and give no fix.
- Keep the candidate's level of ownership. A rewrite may use a stronger verb but must not claim more credit: "Helped with migrating X" can become "Contributed to migrating X", never "Migrated X" or "Led the migration of X". The same goes for "assisted", "supported", "was part of" and "worked on".
- Ignore typos and LaTeX formatting; another tool handles those.
- Return at most 12 issues, most important first. An empty list is fine for a strong resume.

Fixes: when the problem can be fixed by rewording what is already there (e.g. "Responsible for managing a team of 5" -> "Managed a team of 5"), set "find" to the exact text copied verbatim from the LaTeX source (including escapes like \\& or \\%) and "replace" to the rewritten text in the same LaTeX style. "find" must occur exactly once in the source; keep it as short as possible while unique. Otherwise leave both empty.`;

const reviewSchema = z.object({
  issues: z
    .array(
      z.object({
        category: z.enum(['impact', 'clarity', 'consistency', 'length']),
        severity: z.enum(['high', 'medium', 'low']),
        title: z.string().describe('Short label, e.g. "Bullet lists a duty, not a result"'),
        reason: z.string().describe('One or two sentences on why it matters and what to do'),
        find: z.string().describe('Verbatim LaTeX to replace, or empty'),
        replace: z.string().describe('Replacement LaTeX, or empty'),
      })
    ),
});

const MAX_ISSUES = 12;

type RawIssue = z.infer<typeof reviewSchema>['issues'][number];

function occurrences(haystack: string, needle: string): number {
  return needle ? haystack.split(needle).length - 1 : 0;
}

/**
 * Keeps every issue, but a fix only when it can be applied unambiguously:
 * `find` occurs exactly once in the source and actually changes something.
 */
export function toAtsIssues(tex: string, raw: RawIssue[]): AtsIssue[] {
  return raw.map(({ find, replace, ...issue }, i) => {
    const applicable = find !== replace && occurrences(tex, find) === 1;
    return { ...issue, id: `i${i}`, ...(applicable ? { fix: { find, replace } } : {}) };
  });
}

export async function reviewResumeContent(tex: string): Promise<AtsIssue[]> {
  const { object } = await generateObject({
    model: anthropic(RESUME_MODEL),
    schema: reviewSchema,
    system: REVIEW_PROMPT,
    prompt: tex,
  });
  return toAtsIssues(tex, object.issues.slice(0, MAX_ISSUES));
}

const SEVERITY_PENALTY = { high: 12, medium: 6, low: 2 } as const;

/** 100 minus a penalty per issue by severity, floored at 0. */
export function scoreIssues(issues: AtsIssue[]): number {
  const penalty = issues.reduce((sum, issue) => sum + SEVERITY_PENALTY[issue.severity], 0);
  return Math.max(0, 100 - penalty);
}
