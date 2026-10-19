import type { ProjectSource, StartOptionChoice } from '@/lib/analytics/events';

/**
 * The four cards on the "Start with your document" screen (the last
 * onboarding step and the empty dashboard), in display order. Every option
 * ends with the user's own LaTeX open and compiling in the editor; the aim is
 * that the first session is spent on a real document rather than on a blank
 * project or the generator.
 */
export type StartOption = 'upload' | 'paste' | 'sample' | 'blank';

export const START_OPTIONS: readonly StartOption[] = ['upload', 'paste', 'sample', 'blank'];

/** The `project_created` source for a card; the four options map 1:1. */
export function projectSourceForOption(option: StartOption): ProjectSource {
  return option;
}

export function isStartOption(value: string): value is StartOption {
  return (START_OPTIONS as readonly string[]).includes(value);
}

/** Everything the screen can report in `onboarding_start_option_selected`. */
export type StartChoice = StartOptionChoice;

export type UploadKind = 'tex' | 'zip';

/** Accepted upload extensions; a ZIP is an Overleaf / any multi-file export. */
export const UPLOAD_ACCEPT = '.tex,.zip';

export function uploadKind(fileName: string): UploadKind | null {
  const lower = fileName.trim().toLowerCase();
  if (lower.endsWith('.tex')) return 'tex';
  if (lower.endsWith('.zip')) return 'zip';
  return null;
}

export const PASTE_PROJECT_TITLE = 'Pasted document';
export const BLANK_PROJECT_TITLE = 'My first project';
export const MAX_PROJECT_TITLE_LENGTH = 120;

export interface LatexProjectPayload {
  title: string;
  content: string;
}

/**
 * The text of the first `\title{...}` in a document, with nested braces kept
 * balanced and simple formatting commands (`\textbf{x}`, `\\`) stripped, so it
 * can name the project. `null` when there is no usable title.
 */
export function latexTitle(content: string): string | null {
  const start = content.search(/\\title\s*\{/);
  if (start === -1) return null;
  const open = content.indexOf('{', start);
  let depth = 0;
  let end = -1;
  for (let i = open; i < content.length; i++) {
    const ch = content[i];
    if (ch === '\\') {
      i++;
      continue;
    }
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  if (end === -1) return null;
  const raw = content.slice(open + 1, end);
  const text = raw
    .replace(/\\\\/g, ' ')
    // Footnote-like commands contribute nothing to a title.
    .replace(/\\(thanks|footnote)\s*\{[^{}]*\}/g, '')
    .replace(/\\[a-zA-Z]+\*?\s*(\[[^\]]*\])?\s*\{([^{}]*)\}/g, '$2')
    .replace(/\\[a-zA-Z]+\*?/g, '')
    .replace(/[{}]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return text ? text.slice(0, MAX_PROJECT_TITLE_LENGTH) : null;
}

/** `paper.tex` -> `paper`; `My Thesis.TEX` -> `My Thesis`. */
export function titleFromFileName(fileName: string): string {
  const base = fileName.split('/').pop() ?? fileName;
  const stem = base.replace(/\.(tex|zip)$/i, '').trim();
  return (stem || PASTE_PROJECT_TITLE).slice(0, MAX_PROJECT_TITLE_LENGTH);
}

/**
 * Wraps a pasted fragment (no `\documentclass`) in a minimal article preamble
 * so it compiles on the first try. A full document is returned unchanged.
 */
export function ensureDocument(content: string): string {
  if (/\\documentclass/.test(content)) return content;
  return [
    '\\documentclass{article}',
    '\\usepackage[utf8]{inputenc}',
    '\\usepackage{amsmath,amssymb}',
    '\\usepackage{graphicx}',
    '',
    '\\begin{document}',
    '',
    content.trim(),
    '',
    '\\end{document}',
    '',
  ].join('\n');
}

/**
 * The project a pasted LaTeX snippet becomes: `null` for blank input,
 * otherwise `main.tex` content (wrapped if it was a fragment) titled after
 * its `\title{}` or a fallback.
 */
export function projectPayloadFromPaste(
  pasted: string,
  fallbackTitle: string = PASTE_PROJECT_TITLE
): LatexProjectPayload | null {
  if (!pasted.trim()) return null;
  const content = ensureDocument(pasted.replace(/\r\n/g, '\n'));
  return { title: latexTitle(content) ?? fallbackTitle, content };
}

/** The project an uploaded `.tex` file becomes; titled after `\title{}`, else the file name. */
export function projectPayloadFromTexUpload(
  fileName: string,
  content: string
): LatexProjectPayload | null {
  return projectPayloadFromPaste(content, titleFromFileName(fileName));
}
