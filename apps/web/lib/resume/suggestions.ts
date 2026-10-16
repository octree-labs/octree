import { anthropic } from '@ai-sdk/anthropic';
import { generateObject } from 'ai';
import { z } from 'zod';
import type { ResumeSuggestion } from '@/types/resume';
import { RESUME_MODEL } from './redesign';

const SUGGESTIONS_PROMPT = `You review a resume that was just converted to LaTeX. The conversion deliberately preserved the original content exactly, including its mistakes. Your job is to point out objective mistakes the candidate would want fixed.

Look for:
- typo: misspellings, including inconsistent spellings of the same name (e.g. a company spelled two ways)
- consistency: inconsistent date formats, capitalization, or punctuation across similar items (e.g. one bullet ending with a period when the others don't)
- misplaced: words that clearly belong elsewhere, e.g. a stray word stuck onto a heading or label by a PDF export
- grammar: clear grammatical errors

Do NOT suggest rewording, stronger verbs, new content, reordering, or anything subjective. Never change facts: numbers, metrics, dates, job titles, product or hardware model names, or technologies, even if you believe they are wrong (only fix a name when the resume itself spells it two different ways). When in doubt, leave it out. Return at most 10 suggestions; an empty list is fine.

Each suggestion's "find" must be copied verbatim from the LaTeX source (including escapes like \\& or \\_), be long enough to occur exactly once, and "replace" is what that exact text becomes. Keep both as short as possible while unique.`;

const suggestionSchema = z.object({
  suggestions: z.array(
    z.object({
      category: z.enum(['typo', 'consistency', 'misplaced', 'grammar']),
      title: z.string().describe('Short label, e.g. "Vodaphone -> Vodafone"'),
      reason: z.string().describe('One sentence explaining the fix'),
      find: z.string(),
      replace: z.string(),
    })
  ),
});

function occurrences(haystack: string, needle: string): number {
  return needle ? haystack.split(needle).length - 1 : 0;
}

export async function suggestResumeFixes(
  tex: string
): Promise<ResumeSuggestion[]> {
  const { object } = await generateObject({
    model: anthropic(RESUME_MODEL),
    schema: suggestionSchema,
    system: SUGGESTIONS_PROMPT,
    prompt: tex,
  });

  // Only keep suggestions that can be applied unambiguously.
  return object.suggestions
    .filter((s) => s.find !== s.replace && occurrences(tex, s.find) === 1)
    .map((s, i) => ({ ...s, id: `s${i}` }));
}
