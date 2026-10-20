/**
 * The post-compile "try one AI edit" nudge, pure parts.
 *
 * Imported users (tools.useoctree.com -> /import) compile, download and
 * leave without ever asking for an AI edit, so the first successful compile
 * in the editor shows one small card with three one-click prompts. This file
 * decides *which* prompts fit the document and *whether* the card may show;
 * the hook (hooks/use-first-edit-nudge.ts) wires it to the editor and the
 * component (components/editor/first-edit-nudge.tsx) draws it.
 */

import type { FirstEditNudgeSuggestion } from '@/lib/analytics/events';

export interface NudgeSuggestion {
  /** Stable id, also the analytics `suggestion` property. */
  id: FirstEditNudgeSuggestion;
  /** Button label. */
  label: string;
  /** What is sent to the AI edit chat, verbatim. */
  prompt: string;
}

/**
 * Any `\cite`, `\citep`, `\citet`, `\autocite`, `\parencite`, `\textcite`,
 * `\nocite`, ... (starred or with optional arguments) or a bibliography
 * command: `\bibliography{}`, `\addbibresource{}`, `\printbibliography`.
 */
const CITATION_PATTERN =
  /\\(?:[a-zA-Z]*cite[a-zA-Z]*\*?\s*(?:\[[^\]]*\]\s*)*\{|bibliography\s*\{|addbibresource\s*(?:\[[^\]]*\]\s*)?\{|printbibliography\b)/;
const ABSTRACT_PATTERN = /\\begin\s*\{abstract\}/;
const DOCUMENTCLASS_PATTERN = /\\documentclass\b/;

/**
 * Drops `%` comments (to end of line) so a commented-out `\begin{abstract}`
 * or `\cite{}` does not count. `\%` is a literal percent and is kept.
 */
export function stripLatexComments(latex: string): string {
  return latex.replace(/(^|[^\\])%[^\n]*/g, '$1');
}

export function hasAbstract(latex: string): boolean {
  return ABSTRACT_PATTERN.test(stripLatexComments(latex));
}

export function hasCitations(latex: string): boolean {
  return CITATION_PATTERN.test(stripLatexComments(latex));
}

export interface NudgeSourceFile {
  path: string;
  content: string;
}

const isTexPath = (path: string) => /\.tex$/i.test(path);

/**
 * The LaTeX the prompts are chosen from: the main `.tex` file first
 * (`main.tex`, else the one `.tex` file with a `\documentclass`, else the
 * file open in the editor), followed by the project's other `.tex` files so
 * an abstract or `\cite` living in an `\input` section still counts. The
 * open file's text comes from the editor (`selectedContent`), which is ahead
 * of the saved copy.
 */
export function collectNudgeSource(
  files: NudgeSourceFile[],
  selectedPath: string | null,
  selectedContent: string
): string {
  const texFiles = files
    .filter((file) => isTexPath(file.path))
    .map((file) => (file.path === selectedPath ? { ...file, content: selectedContent } : file));
  if (selectedPath && isTexPath(selectedPath) && !texFiles.some((file) => file.path === selectedPath)) {
    texFiles.push({ path: selectedPath, content: selectedContent });
  }
  if (texFiles.length === 0) return selectedContent ?? '';

  const withDocumentClass = texFiles.filter((file) =>
    DOCUMENTCLASS_PATTERN.test(stripLatexComments(file.content ?? ''))
  );
  const main =
    texFiles.find((file) => file.path === 'main.tex') ??
    (withDocumentClass.length === 1 ? withDocumentClass[0] : null) ??
    texFiles.find((file) => file.path === selectedPath) ??
    texFiles[0];

  return [main, ...texFiles.filter((file) => file !== main)]
    .map((file) => file.content ?? '')
    .join('\n');
}

/**
 * Three suggestions for the document: the formatting one always, then one
 * about the opening (abstract if there is one, else the introduction) and
 * one about references (citations if any, else a table of contents).
 */
export function pickNudgeSuggestions(latex: string): NudgeSuggestion[] {
  const source = latex ?? '';
  return [
    {
      id: 'fix_formatting',
      label: 'Fix formatting and spacing',
      prompt: 'Fix formatting and spacing',
    },
    hasAbstract(source)
      ? { id: 'tighten_abstract', label: 'Tighten my abstract', prompt: 'Tighten my abstract' }
      : {
          id: 'tighten_introduction',
          label: 'Tighten the introduction',
          prompt: 'Tighten the introduction',
        },
    hasCitations(source)
      ? {
          id: 'check_citations',
          label: 'Check my citations and references',
          prompt: 'Check my citations and references',
        }
      : { id: 'add_toc', label: 'Add a table of contents', prompt: 'Add a table of contents' },
  ];
}

export interface NudgeDecisionInput {
  /** FIRST_EDIT_NUDGE_ENABLED (data/constants.ts). */
  enabled: boolean;
  /** The card was already shown to this user on this browser. */
  alreadyShown: boolean;
  /** The user has requested an AI edit before (local flag or server counts). */
  hasEdited: boolean;
}

/** Once per user, never after an edit, and only while the switch is on. */
export function shouldShowFirstEditNudge({ enabled, alreadyShown, hasEdited }: NudgeDecisionInput): boolean {
  return enabled && !alreadyShown && !hasEdited;
}

/**
 * The server's view of "has edited": `editCount` is today's count for free
 * users and `monthlyEditCount` this period's for Pro, so either being
 * positive is proof; zero is not (the free counter resets daily), which is
 * what the local flag below is for.
 */
export function usageShowsEdits(
  usage: { editCount?: number; monthlyEditCount?: number } | null | undefined
): boolean {
  if (!usage) return false;
  return (usage.editCount ?? 0) > 0 || (usage.monthlyEditCount ?? 0) > 0;
}

// --- localStorage flags, per user ------------------------------------------

const SHOWN_KEY_PREFIX = 'octree:first-edit-nudge:shown:';
const EDITED_KEY_PREFIX = 'octree:ai-edit-requested:';

export function nudgeShownKey(userId: string): string {
  return `${SHOWN_KEY_PREFIX}${userId}`;
}

export function aiEditRequestedKey(userId: string): string {
  return `${EDITED_KEY_PREFIX}${userId}`;
}

function readFlag(key: string): boolean {
  try {
    return typeof window !== 'undefined' && window.localStorage.getItem(key) !== null;
  } catch {
    return false;
  }
}

function writeFlag(key: string): void {
  try {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(key, new Date().toISOString());
  } catch {
    // Private mode / blocked storage: the card may show again next visit; fine.
  }
}

export function wasNudgeShown(userId: string): boolean {
  return readFlag(nudgeShownKey(userId));
}

export function markNudgeShown(userId: string): void {
  writeFlag(nudgeShownKey(userId));
}

export function hasRequestedAiEdit(userId: string): boolean {
  return readFlag(aiEditRequestedKey(userId));
}

export function markAiEditRequested(userId: string): void {
  writeFlag(aiEditRequestedKey(userId));
}
