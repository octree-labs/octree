import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { API_MAX_FILES, validateApiCompileRequest, type ApiCompileRequest } from '@/lib/api/compile-request';
import type { ApiCompileFailure, ApiCompileSuccess } from '@/lib/api/compile-result';

/**
 * The Octree MCP server (app/api/mcp): three tools over the public compile
 * API. Tool handlers take their I/O as `OctreeToolDeps` so they are unit
 * tested without the compile service, Supabase or the transport.
 */

export const OCTREE_MCP_SERVER_NAME = 'octree';
export const OCTREE_MCP_SERVER_VERSION = '1.0.0';

export const OCTREE_MCP_INSTRUCTIONS = [
  'Octree compiles LaTeX to PDF with a full TeX Live installation (pdfLaTeX by default; XeLaTeX or LuaLaTeX are picked automatically when the document needs them, e.g. fontspec or luacode). Sources and PDFs are not stored.',
  'Tools: compile_latex compiles a single source (`latex`) or a multi-file project (`files` + optional `main`) and returns a summary plus the PDF as an embedded application/pdf resource;',
  'check_latex compiles the same input but returns only errors and warnings (faster to read, no PDF);',
  'get_quota returns the plan, the daily compile limit and how many compiles were used today (UTC).',
  'A LaTeX failure is not a tool error: the result says ok=false and lists structured errors as {file, line, message, kind} (kind is one of missing_package, undefined_control_sequence, missing_dollar, missing_brace, latex_error), usually with a suggestion. Fix the first error first; later ones often cascade from it.',
  'compile_latex and check_latex both run the compiler, so every call to either counts toward the daily compile quota (same quota as the REST API).',
  'Text files only (.tex, .bib, .cls, .sty, ...); binary files such as images are not supported yet.',
].join(' ');

export interface OctreeCompileResult {
  kind: 'result';
  json: ApiCompileSuccess | ApiCompileFailure;
}

export interface OctreeCompileError {
  kind: 'error';
  status: number;
  body: Record<string, unknown>;
}

export interface OctreeToolDeps {
  compile(request: ApiCompileRequest, options: { skipPageCount?: boolean }): Promise<OctreeCompileResult | OctreeCompileError>;
  usage(): Promise<Record<string, unknown>>;
}

export const compileInputShape = {
  latex: z
    .string()
    .optional()
    .describe('A complete single-file LaTeX document (with \\documentclass). Use this or `files`.'),
  files: z
    .array(
      z.object({
        path: z.string().describe('Relative path, e.g. main.tex, sections/intro.tex, refs.bib'),
        content: z.string().describe('Text contents of the file'),
      })
    )
    .max(API_MAX_FILES)
    .optional()
    .describe(`A multi-file project of text files (at most ${API_MAX_FILES} files, 2 MB in total; no binary files). Use this or \`latex\`.`),
  main: z
    .string()
    .optional()
    .describe('With `files`: the root .tex file. Defaults to main.tex, else the first .tex file with \\documentclass.'),
};

export type CompileToolArgs = {
  latex?: string;
  files?: { path: string; content: string }[];
  main?: string;
};

function textResult(text: string, isError = false): CallToolResult {
  return { content: [{ type: 'text', text }], ...(isError ? { isError: true } : {}) };
}

function errorText(error: OctreeCompileError): string {
  const body = error.body;
  const message = typeof body.message === 'string' ? body.message : String(body.error ?? 'Request failed');
  return `${message}\n\n${JSON.stringify(body, null, 2)}`;
}

function toRequest(args: CompileToolArgs) {
  const body: Record<string, unknown> = {};
  if (args.latex !== undefined) body.latex = args.latex;
  if (args.files !== undefined) body.files = args.files;
  if (args.main !== undefined) body.main = args.main;
  return validateApiCompileRequest(body);
}

/** One line per error: `main.tex:12 [undefined_control_sequence] Undefined control sequence.` */
export function formatErrors(failure: ApiCompileFailure): string {
  return failure.errors
    .map((e) => {
      const where = e.file ? `${e.file}${e.line ? `:${e.line}` : ''}` : e.line ? `line ${e.line}` : '(no location)';
      return `- ${where} [${e.kind}] ${e.message}`;
    })
    .join('\n');
}

function failureText(failure: ApiCompileFailure): string {
  const lines = [
    `Compilation failed (ok=false) with ${failure.errors.length} error${failure.errors.length === 1 ? '' : 's'} in ${failure.duration_ms} ms:`,
    formatErrors(failure),
  ];
  if (failure.suggestion) lines.push('', `Suggestion: ${failure.suggestion}`);
  lines.push(
    '',
    JSON.stringify(
      { ok: false, errors: failure.errors, suggestion: failure.suggestion, duration_ms: failure.duration_ms },
      null,
      2
    )
  );
  if (failure.log_tail) lines.push('', 'Log tail:', failure.log_tail);
  return lines.join('\n');
}

export async function compileLatexTool(args: CompileToolArgs, deps: OctreeToolDeps): Promise<CallToolResult> {
  const validation = toRequest(args);
  if (!validation.ok) return textResult(validation.error.body.message, true);

  const outcome = await deps.compile(validation.request, {});
  if (outcome.kind === 'error') return textResult(errorText(outcome), true);

  const json = outcome.json;
  if (!json.ok) return textResult(failureText(json));

  const summary = {
    ok: true,
    pages: json.pages ?? null,
    duration_ms: json.duration_ms,
    warnings: json.warnings,
    pdf_bytes: Math.floor((json.pdf_base64.length * 3) / 4),
  };
  return {
    content: [
      {
        type: 'text',
        text: `Compiled successfully (ok=true)${json.pages ? `: ${json.pages} page${json.pages === 1 ? '' : 's'}` : ''} in ${json.duration_ms} ms. The PDF is attached as an application/pdf resource.\n\n${JSON.stringify(summary, null, 2)}`,
      },
      {
        type: 'resource',
        resource: {
          uri: `octree://compile/${Date.now()}.pdf`,
          mimeType: 'application/pdf',
          blob: json.pdf_base64,
        },
      },
    ],
  };
}

export async function checkLatexTool(args: CompileToolArgs, deps: OctreeToolDeps): Promise<CallToolResult> {
  const validation = toRequest(args);
  if (!validation.ok) return textResult(validation.error.body.message, true);

  const outcome = await deps.compile(validation.request, { skipPageCount: true });
  if (outcome.kind === 'error') return textResult(errorText(outcome), true);

  const json = outcome.json;
  if (!json.ok) return textResult(failureText(json));
  const result = { ok: true, errors: [], warnings: json.warnings, duration_ms: json.duration_ms };
  return textResult(
    `No errors (ok=true): the document compiles${json.warnings.length ? ` with ${json.warnings.length} warning(s)` : ''}.\n\n${JSON.stringify(result, null, 2)}`
  );
}

export async function getQuotaTool(deps: OctreeToolDeps): Promise<CallToolResult> {
  const usage = await deps.usage();
  return textResult(JSON.stringify(usage, null, 2));
}

export function createOctreeMcpServer(deps: OctreeToolDeps): McpServer {
  const server = new McpServer(
    { name: OCTREE_MCP_SERVER_NAME, version: OCTREE_MCP_SERVER_VERSION },
    { instructions: OCTREE_MCP_INSTRUCTIONS, capabilities: { tools: {} } }
  );

  const annotations = { readOnlyHint: true, idempotentHint: true, openWorldHint: false };

  server.registerTool(
    'compile_latex',
    {
      title: 'Compile LaTeX to PDF',
      description:
        'Compile a LaTeX document to PDF (pdfLaTeX by default). Pass `latex` (one complete file) or `files` (+ optional `main`), text files only. Returns ok, page count and structured errors; on success the PDF is attached as an application/pdf resource. Counts toward the daily compile quota.',
      inputSchema: compileInputShape,
      annotations,
    },
    async (args) => compileLatexTool(args as CompileToolArgs, deps)
  );

  server.registerTool(
    'check_latex',
    {
      title: 'Check LaTeX for errors',
      description:
        'Compile a LaTeX document and return only its errors and warnings (no PDF). Same input as compile_latex. It runs the compiler, so it counts toward the daily compile quota exactly like compile_latex. Use it to validate edits before producing the final PDF.',
      inputSchema: compileInputShape,
      annotations,
    },
    async (args) => checkLatexTool(args as CompileToolArgs, deps)
  );

  server.registerTool(
    'get_quota',
    {
      title: 'Get compile quota',
      description: "Return the account's plan, daily compile limit and compiles used today (UTC).",
      annotations,
    },
    async () => getQuotaTool(deps)
  );

  return server;
}
