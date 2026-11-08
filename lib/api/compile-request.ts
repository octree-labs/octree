import { posix } from 'path';

/**
 * Validation and normalisation of a public compile request
 * (POST /api/v1/compile and the MCP `compile_latex` / `check_latex` tools).
 *
 *   { "latex": "<single-file source>" }
 *   { "files": [{ "path": "main.tex", "content": "..." }, ...], "main": "main.tex" }
 *
 * plus the optional `"response": "json" | "pdf"`. A single `latex` source
 * becomes one `main.tex`. Paths follow the compile service's rules
 * (services/compile/internal/helpers.go `validateFilePath`): relative, no
 * NUL, at most 512 characters, never escaping the project directory.
 */

export const API_MAX_FILES = 50;
export const API_MAX_SOURCE_BYTES = 2 * 1024 * 1024;
export const API_MAX_PATH_LENGTH = 512;
export const API_DEFAULT_MAIN = 'main.tex';

export type ApiResponseFormat = 'json' | 'pdf';

/** Text files only in v1 (no binary/base64 entries). */
export interface ApiFileEntry {
  path: string;
  content: string;
}

export interface ApiCompileRequest {
  /** Main file first: the compile service compiles the first `.tex` file with `\documentclass`. */
  files: ApiFileEntry[];
  main: string;
  response: ApiResponseFormat;
  /** UTF-8 bytes of every file's content as sent. */
  sourceBytes: number;
}

export interface ApiRequestError {
  status: 400 | 413;
  body: { error: 'invalid_request' | 'payload_too_large'; message: string };
}

export type ApiRequestValidation = { ok: true; request: ApiCompileRequest } | { ok: false; error: ApiRequestError };

function invalid(message: string): { ok: false; error: ApiRequestError } {
  return { ok: false, error: { status: 400, body: { error: 'invalid_request', message } } };
}

/** Why a file path is rejected, or null when it is acceptable. */
export function filePathProblem(path: unknown): string | null {
  if (typeof path !== 'string' || path === '') return 'file path must be a non-empty string';
  if (path.length > API_MAX_PATH_LENGTH) return `file path longer than ${API_MAX_PATH_LENGTH} characters`;
  if (path.includes('\0')) return 'file path contains a NUL byte';
  if (path.includes('\\')) return `file path must use forward slashes: "${path}"`;
  if (path.startsWith('/') || /^[A-Za-z]:/.test(path)) return `file path must be relative: "${path}"`;
  const cleaned = posix.normalize(path);
  if (cleaned === '.' || cleaned === '..' || cleaned.startsWith('../') || cleaned.endsWith('/')) {
    return `file path escapes the project directory or is not a file: "${path}"`;
  }
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Validates a parsed JSON body. `acceptPdf` is true when the client sent
 * `Accept: application/pdf`; an explicit `response` field wins over it.
 */
export function validateApiCompileRequest(body: unknown, acceptPdf = false): ApiRequestValidation {
  if (!isRecord(body)) return invalid('Body must be a JSON object with "latex" or "files".');

  let response: ApiResponseFormat = acceptPdf ? 'pdf' : 'json';
  if (body.response !== undefined) {
    if (body.response !== 'json' && body.response !== 'pdf') return invalid('"response" must be "json" or "pdf".');
    response = body.response;
  }

  const hasLatex = body.latex !== undefined;
  const hasFiles = body.files !== undefined;
  if (hasLatex && hasFiles) return invalid('Send either "latex" or "files", not both.');
  if (!hasLatex && !hasFiles) return invalid('Missing "latex" (a single-file source) or "files" (a project).');

  let files: ApiFileEntry[];
  let main: string;

  if (hasLatex) {
    if (typeof body.latex !== 'string' || body.latex.trim() === '') return invalid('"latex" must be a non-empty string.');
    if (body.main !== undefined && body.main !== API_DEFAULT_MAIN) {
      return invalid('"main" applies only with "files".');
    }
    files = [{ path: API_DEFAULT_MAIN, content: body.latex }];
    main = API_DEFAULT_MAIN;
  } else {
    if (!Array.isArray(body.files) || body.files.length === 0) return invalid('"files" must be a non-empty array.');
    if (body.files.length > API_MAX_FILES) return invalid(`Too many files (${body.files.length}); the limit is ${API_MAX_FILES}.`);

    files = [];
    const seen = new Set<string>();
    for (const [index, raw] of body.files.entries()) {
      if (!isRecord(raw)) return invalid(`files[${index}] must be an object with "path" and "content".`);
      const problem = filePathProblem(raw.path);
      if (problem) return invalid(`files[${index}]: ${problem}.`);
      const path = posix.normalize(raw.path as string);
      if (seen.has(path)) return invalid(`files[${index}]: duplicate path "${path}".`);
      seen.add(path);
      if (typeof raw.content !== 'string') return invalid(`files[${index}].content must be a string.`);
      if (raw.encoding !== undefined) {
        return invalid(`files[${index}]: only text files are supported (no "encoding").`);
      }
      files.push({ path, content: raw.content });
    }

    const texFiles = files.filter((f) => f.path.endsWith('.tex'));
    if (body.main !== undefined) {
      if (typeof body.main !== 'string') return invalid('"main" must be a string.');
      main = posix.normalize(body.main);
      if (!files.some((f) => f.path === main)) return invalid(`"main" ("${body.main}") is not one of the files.`);
    } else if (files.some((f) => f.path === API_DEFAULT_MAIN)) {
      main = API_DEFAULT_MAIN;
    } else {
      const withClass = texFiles.find((f) => f.content.includes('\\documentclass'));
      if (!withClass) return invalid('No .tex file with \\documentclass; set "main" to the root file.');
      main = withClass.path;
    }

    const mainFile = files.find((f) => f.path === main)!;
    if (!main.endsWith('.tex')) return invalid(`"main" must be a .tex file.`);
    if (!mainFile.content.includes('\\documentclass')) {
      return invalid(`The main file "${main}" has no \\documentclass.`);
    }
    // The compile service compiles the first .tex file containing
    // \documentclass, so the main file goes first.
    files = [mainFile, ...files.filter((f) => f !== mainFile)];
  }

  const sourceBytes = files.reduce((sum, f) => sum + Buffer.byteLength(f.content, 'utf8'), 0);
  if (sourceBytes > API_MAX_SOURCE_BYTES) {
    return {
      ok: false,
      error: {
        status: 413,
        body: {
          error: 'payload_too_large',
          message: `Source is ${sourceBytes} bytes; the limit is ${API_MAX_SOURCE_BYTES} (2 MB).`,
        },
      },
    };
  }

  return { ok: true, request: { files, main, response, sourceBytes } };
}
