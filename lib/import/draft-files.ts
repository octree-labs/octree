import { posix } from 'path';
import {
  API_MAX_FILES,
  API_MAX_SOURCE_BYTES,
  validateApiCompileRequest,
} from '@/lib/api/compile-request';
import { isBinaryFile } from '@/lib/constants/file-types';

/**
 * Multi-file "Open in Octree" drafts.
 *
 * tools.useoctree.com may post `files` (a JSON array of `{ path, content }`)
 * and an optional `main` alongside the single `content` field. Paths and caps
 * follow the public compile API (lib/api/compile-request.ts, itself mirroring
 * the compile service): relative, forward slashes, no `..` escape, no
 * duplicates, at most 50 files and 2 MB of UTF-8 in total. Text files only:
 * binary extensions (images, PDFs, fonts) are refused because a draft has no
 * way to carry their bytes.
 *
 * The main file is `main` when given, else `main.tex` when it has a
 * `\documentclass`, else the first `.tex` file that has one. Validated files
 * are returned main first, which is also the order the compile service needs
 * (it compiles the first `.tex` file with `\documentclass`).
 */

export const DRAFT_MAX_FILES = API_MAX_FILES;
export const DRAFT_MAX_FILES_BYTES = API_MAX_SOURCE_BYTES;

export interface DraftFile {
  path: string;
  content: string;
}

export type DraftFilesValidation =
  | { ok: true; files: DraftFile[]; main: string }
  | { ok: false; status: 400 | 413; error: string };

function invalid(error: string): DraftFilesValidation {
  return { ok: false, status: 400, error };
}

function hasDocumentClass(content: string) {
  return /\\documentclass\b/.test(content);
}

function detectMain(files: Array<{ path?: unknown; content?: unknown }>): string | undefined {
  const tex = files.filter(
    (f): f is DraftFile => typeof f?.path === 'string' && typeof f?.content === 'string' && f.path.endsWith('.tex')
  );
  const mainTex = tex.find((f) => posix.normalize(f.path) === 'main.tex');
  if (mainTex && hasDocumentClass(mainTex.content)) return 'main.tex';
  const withClass = tex.find((f) => hasDocumentClass(f.content));
  return withClass ? posix.normalize(withClass.path) : undefined;
}

/**
 * Validates a `files` payload (already JSON-parsed) and an optional `main`.
 * Returns the normalised files, main first.
 */
export function validateDraftFiles(input: unknown, mainInput?: unknown): DraftFilesValidation {
  if (!Array.isArray(input) || input.length === 0) return invalid('"files" must be a non-empty array.');
  if (input.length > DRAFT_MAX_FILES) {
    return invalid(`Too many files (${input.length}); the limit is ${DRAFT_MAX_FILES}.`);
  }

  for (const [index, raw] of input.entries()) {
    const path = (raw as { path?: unknown } | null)?.path;
    if (typeof path === 'string' && isBinaryFile(path)) {
      return invalid(`files[${index}]: only text files are supported ("${path}").`);
    }
  }

  let main: string | undefined;
  if (mainInput !== undefined && mainInput !== null && mainInput !== '') {
    if (typeof mainInput !== 'string') return invalid('"main" must be a string.');
    main = mainInput;
  } else {
    main = detectMain(input as Array<{ path?: unknown; content?: unknown }>);
    if (!main) return invalid('No .tex file with \\documentclass; set "main" to the root file.');
  }

  const result = validateApiCompileRequest({ files: input, main });
  if (!result.ok) {
    return { ok: false, status: result.error.status, error: result.error.body.message };
  }
  return { ok: true, files: result.request.files, main: result.request.main };
}

/** Parses the `files` form field (a JSON string) or passes a JSON body's array through. */
export function parseDraftFilesField(raw: unknown): { ok: true; value: unknown } | { ok: false } {
  if (typeof raw !== 'string') return { ok: true, value: raw };
  try {
    return { ok: true, value: JSON.parse(raw) };
  } catch {
    return { ok: false };
  }
}

/**
 * The files of a stored draft row, main first, or null for a single-file
 * draft. Rows are re-validated on read because the anon key can insert into
 * `drafts` directly, bypassing /api/drafts; an invalid `files` value falls
 * back to the single `content`.
 */
export function storedDraftFiles(row: { files?: unknown } | null | undefined): DraftFile[] | null {
  const files = row?.files;
  if (!Array.isArray(files) || files.length === 0) return null;
  const first = files[0] as { path?: unknown } | undefined;
  const result = validateDraftFiles(files, typeof first?.path === 'string' ? first.path : undefined);
  return result.ok ? result.files : null;
}

/** The files a draft turns into: its stored files, or `main.tex` holding `content`. */
export function draftProjectFiles(row: { content: string; files?: unknown }): DraftFile[] {
  return storedDraftFiles(row) ?? [{ path: 'main.tex', content: row.content }];
}
