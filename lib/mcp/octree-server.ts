import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult, ContentBlock } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { API_MAX_FILES, validateApiCompileRequest, type ApiCompileRequest } from '@/lib/api/compile-request';
import {
  structureWarnings,
  type ApiCompileFailure,
  type ApiCompileJson,
  type ApiCompileSuccess,
  type ApiQuotaSnapshot,
} from '@/lib/api/compile-result';

/**
 * The Octree MCP server (app/api/mcp): three tools over the public compile
 * API. Tool handlers take their I/O as `OctreeToolDeps` so they are unit
 * tested without the compile service, Supabase or the transport.
 *
 * Every tool declares an `outputSchema` and answers with `structuredContent`
 * plus a short text summary (clients that ignore structured output still get
 * the errors, hints, PDF link and quota from the text). The PDF goes out as
 * a `resource_link` to a one-hour signed URL; base64 is opt-in
 * (`include_pdf_base64`) because a large blob fills the agent's context.
 */

export const OCTREE_MCP_SERVER_NAME = 'octree';
export const OCTREE_MCP_SERVER_VERSION = '1.1.0';

export const OCTREE_MCP_INSTRUCTIONS = [
  'Octree compiles LaTeX to PDF with a full TeX Live installation (pdfLaTeX by default; XeLaTeX or LuaLaTeX are picked automatically when the document needs them, e.g. fontspec or luacode).',
  'Tools: compile_latex compiles a single source (`latex`) or a multi-file project (`files` + optional `main`) and returns a link to the PDF (pdf_url, valid for one hour; set include_pdf_base64 to also get the PDF inline);',
  'check_latex compiles the same input but returns only errors and warnings (no PDF) and has its own, larger daily allowance, so use it to validate edits and call compile_latex once for the final PDF;',
  'get_quota returns the plan and how many compiles and checks are left today (UTC).',
  'Results are structured (structuredContent): ok, engine, pages, duration_ms, errors[] as {file, line, message, kind, hint}, warnings[], quota.',
  'A LaTeX failure is not a tool error: ok=false lists the errors; fix the first error first, later ones often cascade from it, and follow its hint.',
  'Text files only (.tex, .bib, .cls, .sty, ...); binary files such as images are not supported yet.',
  'Sources are not stored; compiled PDFs are kept privately for 24 hours behind the signed link.',
].join(' ');

export interface OctreeCompileResult {
  kind: 'result';
  json: ApiCompileJson;
}

export interface OctreeCompileError {
  kind: 'error';
  status: number;
  body: Record<string, unknown>;
}

export interface OctreeCompileOptions {
  mode: 'compile' | 'check';
  /** compile_latex: upload the PDF and return a signed pdf_url. */
  storePdf?: boolean;
}

export interface OctreeToolDeps {
  compile(request: ApiCompileRequest, options: OctreeCompileOptions): Promise<OctreeCompileResult | OctreeCompileError>;
  usage(): Promise<Record<string, unknown>>;
  /**
   * True when the client negotiated an MCP protocol older than 2025-06-18,
   * which has no `resource_link` content block: such clients get the PDF
   * embedded as before instead of a link.
   */
  legacyContent?: boolean;
}

const sourceShape = {
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

export const checkInputShape = sourceShape;

export const compileInputShape = {
  ...sourceShape,
  include_pdf_base64: z
    .boolean()
    .optional()
    .describe(
      'Also attach the PDF inline as a base64 application/pdf resource. Default false: the PDF is returned as a link (pdf_url), which keeps large files out of the context.'
    ),
};

const errorShape = z.object({
  file: z.string().nullable().describe('Source file of the error, when the log names one'),
  line: z.number().int().nullable().describe('1-based line, when the log names one'),
  message: z.string(),
  kind: z.enum(['missing_package', 'undefined_control_sequence', 'missing_dollar', 'missing_brace', 'latex_error']),
  hint: z.string().optional().describe('A one-sentence suggested fix, for common errors'),
});

const warningShape = z.object({
  file: z.string().nullable(),
  line: z.number().int().nullable(),
  message: z.string(),
});

const quotaShape = z.object({
  counter: z.enum(['compiles', 'checks']).describe('The daily counter this call used'),
  limit: z.number().int(),
  used: z.number().int(),
  remaining: z.number().int(),
  resets_at: z.string().describe('ISO time of the next reset (00:00 UTC)'),
});

const engineShape = z.enum(['pdflatex', 'xelatex', 'lualatex']).nullable().describe('The TeX engine that ran, when known');

export const checkOutputShape = {
  ok: z.boolean().describe('true when the document compiled'),
  engine: engineShape,
  duration_ms: z.number().int(),
  errors: z.array(errorShape),
  warnings: z.array(warningShape),
  suggestion: z.string().nullable().describe('A fix for the first error, when one is known'),
  log_tail: z.string().optional().describe('The end of the TeX log (failures only)'),
  quota: quotaShape.nullable(),
};

export const compileOutputShape = {
  ...checkOutputShape,
  pages: z.number().int().nullable(),
  pdf_url: z.string().nullable().describe('Signed link to the PDF, valid until pdf_url_expires_at; null on failure'),
  pdf_url_expires_at: z.string().nullable(),
  pdf_bytes: z.number().int().nullable(),
};

export const quotaOutputShape = {
  user_id: z.string(),
  plan: z.enum(['free', 'pro']),
  daily_limit: z.number().int().describe('Compiles a day (REST API and compile_latex)'),
  used_today: z.number().int(),
  remaining_today: z.number().int(),
  checks_daily_limit: z.number().int().describe('check_latex calls a day'),
  checks_used_today: z.number().int(),
  resets_at: z.string(),
  upgrade_url: z.string().optional(),
};

export type CompileToolArgs = {
  latex?: string;
  files?: { path: string; content: string }[];
  main?: string;
  include_pdf_base64?: boolean;
};

/**
 * The structured result serialized into the text block too, as the MCP spec
 * recommends for backwards compatibility: clients without structuredContent
 * support (and integrations that parsed the JSON this text used to carry)
 * still get every field. `log_tail` is left out, since the text already
 * ends with it.
 */
function withJson(text: string, structured: Record<string, unknown>): string {
  const { log_tail: _logTail, ...rest } = structured;
  return `${text}\n\n${JSON.stringify(rest, null, 2)}`;
}

function textResult(text: string, isError = false): CallToolResult {
  return { content: [{ type: 'text', text }], ...(isError ? { isError: true } : {}) };
}

/** A tool error for quota, request and service problems: the message, the next step, and the body. */
function errorText(error: OctreeCompileError): string {
  const body = error.body;
  const message = typeof body.message === 'string' ? body.message : String(body.error ?? 'Request failed');
  const lines = [message];
  if (body.error === 'quota_exceeded') {
    if (typeof body.resets_at === 'string') lines.push(`The quota resets at ${body.resets_at}.`);
    // The body carries upgrade_url on every plan; only a free account can upgrade.
    if (body.plan !== 'pro' && typeof body.upgrade_url === 'string') {
      const what = body.counter === 'checks' ? 'checks' : 'compiles';
      lines.push(`More ${what} a day with Pro: ${body.upgrade_url}`);
    }
  }
  lines.push('', JSON.stringify(body, null, 2));
  return lines.join('\n');
}

function toRequest(args: CompileToolArgs) {
  const body: Record<string, unknown> = {};
  if (args.latex !== undefined) body.latex = args.latex;
  if (args.files !== undefined) body.files = args.files;
  if (args.main !== undefined) body.main = args.main;
  return validateApiCompileRequest(body);
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

/** One line per error: `1. main.tex:12 [undefined_control_sequence] Undefined control sequence. Hint: ...` */
export function formatErrors(failure: ApiCompileFailure): string {
  return failure.errors
    .map((e, index) => {
      const where = e.file ? `${e.file}${e.line ? `:${e.line}` : ''}` : e.line ? `line ${e.line}` : '(no location)';
      return `${index + 1}. ${where} [${e.kind}] ${e.message}${e.hint ? `\n   Hint: ${e.hint}` : ''}`;
    })
    .join('\n');
}

function quotaLine(quota: ApiQuotaSnapshot | undefined): string | null {
  if (!quota) return null;
  const what = quota.counter === 'checks' ? 'checks' : 'compiles';
  return `Quota: ${quota.remaining} of ${quota.limit} ${what} left today (resets ${quota.resets_at}).`;
}

/** The text summary of a failure; the log tail is cut short here (structuredContent has more). */
const TEXT_LOG_TAIL_CHARS = 1500;

function failureText(failure: ApiCompileFailure): string {
  const meta = [failure.engine, `${failure.duration_ms} ms`].filter(Boolean).join(', ');
  const lines = [
    `Compilation failed (ok=false) with ${plural(failure.errors.length, 'error')} (${meta}). Fix the first one first:`,
    formatErrors(failure),
  ];
  if (failure.suggestion && !failure.errors[0]?.hint) lines.push('', `Suggestion: ${failure.suggestion}`);
  const quota = quotaLine(failure.quota);
  if (quota) lines.push('', quota);
  if (failure.log_tail) {
    const tail = failure.log_tail.slice(-TEXT_LOG_TAIL_CHARS);
    lines.push('', 'Log tail:', tail);
  }
  return lines.join('\n');
}

function structuredFailure(failure: ApiCompileFailure) {
  return {
    ok: false,
    engine: failure.engine ?? null,
    duration_ms: failure.duration_ms,
    errors: failure.errors,
    warnings: structureWarnings(failure.warnings ?? []),
    suggestion: failure.suggestion ?? failure.errors[0]?.hint ?? null,
    log_tail: failure.log_tail,
    quota: failure.quota ?? null,
  };
}

function pdfBytes(success: ApiCompileSuccess): number {
  const b64 = success.pdf_base64;
  const padding = b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0;
  return Math.floor((b64.length * 3) / 4) - padding;
}

export async function compileLatexTool(args: CompileToolArgs, deps: OctreeToolDeps): Promise<CallToolResult> {
  const validation = toRequest(args);
  if (!validation.ok) return textResult(validation.error.body.message, true);

  const outcome = await deps.compile(validation.request, { mode: 'compile', storePdf: true });
  if (outcome.kind === 'error') return textResult(errorText(outcome), true);

  const json = outcome.json;
  if (!json.ok) {
    const structured = { ...structuredFailure(json), pages: null, pdf_url: null, pdf_url_expires_at: null, pdf_bytes: null };
    return { content: [{ type: 'text', text: withJson(failureText(json), structured) }], structuredContent: structured };
  }

  const pdfUrl = json.pdf_url ?? null;
  // Without a link (storage failed) the PDF is attached inline anyway, so
  // the call is never a success without a PDF.
  const legacy = deps.legacyContent === true;
  const inline = args.include_pdf_base64 === true || !pdfUrl || legacy;
  const bytes = pdfBytes(json);
  const meta = [json.pages ? plural(json.pages, 'page') : null, json.engine, `${json.duration_ms} ms`].filter(Boolean).join(', ');
  const lines = [`Compiled successfully (ok=true): ${meta}.`];
  if (pdfUrl) lines.push(`PDF: ${pdfUrl}`, `(signed link, valid until ${json.pdf_url_expires_at}; download it before then)`);
  if (inline) lines.push(pdfUrl ? 'The PDF is also attached inline.' : 'The PDF is attached inline as an application/pdf resource.');
  if (json.warnings.length) lines.push(`${plural(json.warnings.length, 'warning')}: ${json.warnings.slice(0, 5).join(' | ')}`);
  const quota = quotaLine(json.quota);
  if (quota) lines.push(quota);

  const structured = {
    ok: true,
    engine: json.engine ?? null,
    duration_ms: json.duration_ms,
    errors: [],
    warnings: structureWarnings(json.warnings),
    suggestion: null,
    quota: json.quota ?? null,
    pages: json.pages ?? null,
    pdf_url: pdfUrl,
    pdf_url_expires_at: json.pdf_url_expires_at ?? null,
    pdf_bytes: bytes,
  };
  const content: ContentBlock[] = [{ type: 'text', text: withJson(lines.join('\n'), structured) }];
  if (pdfUrl && !legacy) {
    content.push({
      type: 'resource_link',
      uri: pdfUrl,
      name: 'output.pdf',
      title: 'Compiled PDF',
      mimeType: 'application/pdf',
      description: `Compiled PDF (${bytes} bytes); the signed link expires at ${json.pdf_url_expires_at}.`,
      size: bytes,
    });
  }
  if (inline) {
    content.push({
      type: 'resource',
      resource: { uri: `octree://compile/${Date.now()}.pdf`, mimeType: 'application/pdf', blob: json.pdf_base64 },
    });
  }

  return { content, structuredContent: structured };
}

export async function checkLatexTool(args: CompileToolArgs, deps: OctreeToolDeps): Promise<CallToolResult> {
  const validation = toRequest(args);
  if (!validation.ok) return textResult(validation.error.body.message, true);

  const outcome = await deps.compile(validation.request, { mode: 'check' });
  if (outcome.kind === 'error') return textResult(errorText(outcome), true);

  const json = outcome.json;
  if (!json.ok) {
    const structured = structuredFailure(json);
    return { content: [{ type: 'text', text: withJson(failureText(json), structured) }], structuredContent: structured };
  }
  const lines = [
    `No errors (ok=true): the document compiles${json.warnings.length ? ` with ${plural(json.warnings.length, 'warning')}` : ''} (${[json.engine, `${json.duration_ms} ms`].filter(Boolean).join(', ')}). Call compile_latex for the PDF.`,
  ];
  const quota = quotaLine(json.quota);
  if (quota) lines.push(quota);
  const structured = {
    ok: true,
    engine: json.engine ?? null,
    duration_ms: json.duration_ms,
    errors: [],
    warnings: structureWarnings(json.warnings),
    suggestion: null,
    quota: json.quota ?? null,
  };
  return { content: [{ type: 'text', text: withJson(lines.join('\n'), structured) }], structuredContent: structured };
}

export async function getQuotaTool(deps: OctreeToolDeps): Promise<CallToolResult> {
  const usage = await deps.usage();
  const lines = [
    `Plan: ${usage.plan}. Compiles: ${usage.used_today} of ${usage.daily_limit} used today; checks: ${usage.checks_used_today} of ${usage.checks_daily_limit}. Resets at ${usage.resets_at}.`,
  ];
  if (typeof usage.upgrade_url === 'string') lines.push(`Upgrade for more: ${usage.upgrade_url}`);
  return { content: [{ type: 'text', text: withJson(lines.join('\n'), usage) }], structuredContent: usage };
}

export function createOctreeMcpServer(deps: OctreeToolDeps): McpServer {
  const server = new McpServer(
    { name: OCTREE_MCP_SERVER_NAME, version: OCTREE_MCP_SERVER_VERSION },
    { instructions: OCTREE_MCP_INSTRUCTIONS, capabilities: { tools: {} } }
  );

  // Compiling changes nothing the user owns (the stored PDF is a temporary,
  // private copy) and reaches no third party, so all three tools are
  // read-only, non-destructive and closed-world; the same input gives the
  // same result.
  const annotations = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };

  server.registerTool(
    'compile_latex',
    {
      title: 'Compile LaTeX to PDF',
      description:
        'Compile a LaTeX document to PDF (pdfLaTeX by default, XeLaTeX/LuaLaTeX when needed). Pass `latex` (one complete file) or `files` (+ optional `main`), text files only. Returns ok, engine, page count, structured errors with fix hints, and on success a link to the PDF (pdf_url, valid one hour). Set include_pdf_base64 to also get the PDF inline. Counts toward the daily compile quota.',
      inputSchema: compileInputShape,
      outputSchema: compileOutputShape,
      annotations: { title: 'Compile LaTeX to PDF', ...annotations },
    },
    async (args) => compileLatexTool(args as CompileToolArgs, deps)
  );

  server.registerTool(
    'check_latex',
    {
      title: 'Check LaTeX for errors',
      description:
        'Compile a LaTeX document and return only its errors (with fix hints) and warnings, no PDF. Same input as compile_latex. Uses a separate, larger daily allowance than compile_latex, so use it to validate edits and call compile_latex once for the final PDF.',
      inputSchema: checkInputShape,
      outputSchema: checkOutputShape,
      annotations: { title: 'Check LaTeX for errors', ...annotations },
    },
    async (args) => checkLatexTool(args as CompileToolArgs, deps)
  );

  server.registerTool(
    'get_quota',
    {
      title: 'Get compile quota',
      description: "Return the account's plan and today's compile and check usage and limits (UTC days).",
      outputSchema: quotaOutputShape,
      annotations: { title: 'Get compile quota', ...annotations },
    },
    async () => getQuotaTool(deps)
  );

  return server;
}
