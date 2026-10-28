import type { AtsIssue } from '@/types/resume';

type Fix = NonNullable<AtsIssue['fix']>;

/**
 * Where a suggested fix stands against the current LaTeX, worked out from the
 * text alone so it survives reloads and manual edits:
 *
 *  - `ready`:   the original text occurs exactly once; it can be applied.
 *  - `applied`: the original is gone and the rewrite occurs exactly once; it
 *               can be undone by the reverse replacement.
 *  - `stale`:   neither; the line was edited by hand since the analysis.
 */
export type FixState = 'ready' | 'applied' | 'stale';

function occurrences(haystack: string, needle: string): number {
  return needle ? haystack.split(needle).length - 1 : 0;
}

export function fixState(tex: string, fix: Fix): FixState {
  if (occurrences(tex, fix.find) === 1) return 'ready';
  if (occurrences(tex, fix.find) === 0 && occurrences(tex, fix.replace) === 1) return 'applied';
  return 'stale';
}

/** The replacement that undoes an applied fix. */
export function undoFix(fix: Fix): Fix {
  return { find: fix.replace, replace: fix.find };
}
