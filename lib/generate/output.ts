/**
 * What the generate route (app/api/generate-document) does with the model's
 * output once the stream ends: pull the LaTeX document out of it and decide
 * whether the run produced a document, ran out of room, or produced
 * something that is not a document.
 */

/**
 * Output cap for one generation. At 8192 the longest documents (about 24k
 * characters of LaTeX) were cut off before `\end{document}` and the user got
 * nothing; Sonnet 4.6 allows far more when streaming. 32k tokens is roughly
 * 90k characters, and at the slowest rate seen in production (~45 tokens/s)
 * it still finishes inside GENERATE_DEADLINE_MS.
 */
export const GENERATE_MAX_OUTPUT_TOKENS = 32000;

/**
 * The route stops reading the model before the function's own limit
 * (maxDuration, 800 s) so the browser gets a clear "too long" answer
 * instead of a stream that just stops.
 */
export const GENERATE_DEADLINE_MS = 740_000;

export type GenerationEnd =
  | { kind: 'complete'; latex: string }
  /** Ran out of output tokens or time before `\end{document}`. */
  | { kind: 'truncated' }
  /** Finished on its own but what came back is not a LaTeX document. */
  | { kind: 'invalid' };

export function extractLatex(content: string): string | null {
  const trimmed = content.trim();

  const fenceMatch = trimmed.match(/```(?:latex|tex)?\s*([\s\S]*?)```/);
  if (fenceMatch) {
    const extracted = fenceMatch[1].trim();
    if (extracted.includes('\\documentclass') && extracted.includes('\\end{document}')) {
      return extracted;
    }
  }

  if (trimmed.includes('\\documentclass') && trimmed.includes('\\end{document}')) {
    const start = trimmed.indexOf('\\documentclass');
    const end = trimmed.lastIndexOf('\\end{document}') + '\\end{document}'.length;
    return trimmed.slice(start, end);
  }

  return null;
}

export function classifyGenerationEnd(input: {
  content: string;
  stopReason: string | null;
  timedOut: boolean;
}): GenerationEnd {
  const latex = extractLatex(input.content);
  if (latex) return { kind: 'complete', latex };
  if (input.timedOut || input.stopReason === 'max_tokens') return { kind: 'truncated' };
  return { kind: 'invalid' };
}

export const TRUNCATED_MESSAGE =
  'This document came out longer than one generation can write, so it stopped before the end. ' +
  'Try asking for fewer sections or a shorter document, or generate it in parts and ask for the rest in a follow-up.';

export const UPSTREAM_MESSAGE =
  'The AI service had a problem while writing your document. Please try again in a minute.';
