import { anthropic } from '@ai-sdk/anthropic';
import { generateObject } from 'ai';
import { z } from 'zod';
import type { AtsJobMatch, AtsKeyword } from '@/types/resume';
import { RESUME_MODEL } from '../redesign';

// The model only reads the job description and lists what an ATS would
// search for; whether the resume contains each keyword is decided here, by
// plain text matching, so the score is repeatable and explainable.

const KEYWORDS_PROMPT = `You read a job description and list the keywords an applicant tracking system (ATS) would search resumes for.

Include: hard skills, programming languages, frameworks, tools, platforms, methodologies, certifications, degrees, and domain terms.
Exclude: soft skills and generic phrases ("team player", "fast-paced", "communication"), company names, benefits, and locations.

For each keyword:
- "keyword": the canonical spelling as a recruiter would type it (e.g. "Kubernetes", "CI/CD", "Bachelor's degree in Computer Science" -> "Computer Science").
- "importance": "required" if the description lists it as a requirement or must-have, otherwise "preferred".
- "aliases": other spellings and abbreviations a resume might use for the same thing (e.g. Kubernetes -> ["K8s"], JavaScript -> ["JS"], PostgreSQL -> ["Postgres"]). Empty when there are none.

Return at most 25 keywords, most important first, without duplicates.`;

const keywordSchema = z.object({
  keywords: z
    .array(
      z.object({
        keyword: z.string(),
        importance: z.enum(['required', 'preferred']),
        aliases: z.array(z.string()),
      })
    ),
});

export type JobKeyword = z.infer<typeof keywordSchema>['keywords'][number];

const MAX_KEYWORDS = 25;

export async function extractJobKeywords(jobDescription: string): Promise<JobKeyword[]> {
  const { object } = await generateObject({
    model: anthropic(RESUME_MODEL),
    schema: keywordSchema,
    system: KEYWORDS_PROMPT,
    prompt: jobDescription,
  });
  return object.keywords.slice(0, MAX_KEYWORDS);
}

/**
 * Lower-case, ligatures and accents folded (NFKD), and separators unified so
 * "CI/CD", "CI-CD" and "CI CD" compare equal.
 */
function normalize(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[‐-―/_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Whole-term match: "Java" does not match "JavaScript", and "C" matches
 * neither "CSS" nor "C++"/"C#" (a trailing + or # is part of the name).
 */
function containsTerm(haystack: string, term: string): boolean {
  const needle = normalize(term);
  if (!needle) return false;
  return new RegExp(`(?<![a-z0-9])${escapeRegExp(needle)}(?![a-z0-9+#])`).test(haystack);
}

export function matchKeywords(resumeText: string, keywords: JobKeyword[]): AtsKeyword[] {
  const haystack = normalize(resumeText);
  const seen = new Set<string>();
  const result: AtsKeyword[] = [];

  for (const { keyword, importance, aliases } of keywords) {
    const key = normalize(keyword);
    if (!key || seen.has(key)) continue;
    seen.add(key);

    if (containsTerm(haystack, keyword)) {
      result.push({ keyword, importance, matched: true });
      continue;
    }
    const alias = aliases.find((a) => containsTerm(haystack, a));
    result.push(alias ? { keyword, importance, matched: true, matchedAs: alias } : { keyword, importance, matched: false });
  }

  return result;
}

const WEIGHT = { required: 2, preferred: 1 } as const;

/** 0-100 of the keyword weight found; null when there is nothing to match. */
export function scoreJobMatch(keywords: AtsKeyword[]): number | null {
  const total = keywords.reduce((sum, k) => sum + WEIGHT[k.importance], 0);
  if (total === 0) return null;
  const found = keywords.reduce((sum, k) => sum + (k.matched ? WEIGHT[k.importance] : 0), 0);
  return Math.round((found / total) * 100);
}

export async function matchJobDescription(resumeText: string, jobDescription: string): Promise<AtsJobMatch | null> {
  const keywords = matchKeywords(resumeText, await extractJobKeywords(jobDescription));
  const score = scoreJobMatch(keywords);
  return score === null ? null : { score, keywords };
}
