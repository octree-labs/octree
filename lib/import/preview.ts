import 'server-only';

import { createHmac } from 'crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createAdminClient } from '@/lib/supabase/admin';
import { PENDING_DRAFT_MAX_AGE_SECONDS, isDraftId } from '@/lib/import/pending-draft';

/**
 * Server-side PDF preview of an "Open in Octree" draft for logged-out
 * visitors of /import/start. The draft is compiled once with the compile
 * service and the result (PDF or error summary) is kept in the private
 * `import-previews` storage bucket, so a refresh, a second device or another
 * Vercel instance never compiles the same draft again.
 *
 * Nothing here touches a user session: the draft is read with the service
 * role (drafts are anonymous rows) and the compile service is called with a
 * server credential (see `compileServiceToken`).
 */

export const PREVIEW_BUCKET = 'import-previews';
/** Drafts older than the pending-draft cookie (7 days) are not previewed. */
export const PREVIEW_MAX_AGE_MS = PENDING_DRAFT_MAX_AGE_SECONDS * 1000;
export const PREVIEW_COMPILE_TIMEOUT_MS = 20_000;
/** Error lines kept from the compiler log for the visitor. */
export const PREVIEW_ERROR_LINES = 3;
/** Drafts bigger than this are not compiled for a preview (the editor still opens them). */
export const PREVIEW_MAX_CONTENT_CHARS = 200_000;

export type PreviewFailure =
  | 'not_found'
  | 'consumed'
  | 'expired'
  | 'too_large'
  | 'unsupported'
  | 'compile_failed'
  | 'unavailable';

export type PreviewResult =
  | { ok: true; pdf: Buffer; cached: boolean; title: string | null; source: string | null }
  | { ok: false; reason: PreviewFailure; errorLines?: string[]; cached?: boolean };

export interface PreviewDraft {
  id: string;
  title: string | null;
  content: string;
  source: string | null;
  consumed_at: string | null;
  created_at: string;
}

// ---------------------------------------------------------------------------
// Wrapping (mirrors tools.useoctree.com lib/wrap-document.ts)
// ---------------------------------------------------------------------------

type WrapPackage =
  | 'tikz'
  | 'pgfplots'
  | 'booktabs'
  | 'graphicx'
  | 'multirow'
  | 'hyperref'
  | 'mathtools'
  | 'xcolor';

const PACKAGE_ORDER: WrapPackage[] = [
  'mathtools',
  'graphicx',
  'xcolor',
  'booktabs',
  'multirow',
  'tikz',
  'pgfplots',
  'hyperref',
];

const DETECTORS: Array<[WrapPackage, RegExp]> = [
  ['tikz', /\\begin\{tikzpicture\}|\\tikz\b|\\usetikzlibrary/],
  ['pgfplots', /\\begin\{axis\}|\\addplot|\\pgfplotsset/],
  ['booktabs', /\\(toprule|midrule|bottomrule|cmidrule)\b/],
  ['graphicx', /\\includegraphics\b/],
  ['multirow', /\\multirow\b/],
  ['hyperref', /\\(href|url)\b/],
  ['xcolor', /\\(textcolor|color|definecolor|colorbox)\b/],
];

const PACKAGE_LINE = /^\s*\\usepackage(?:\[[^\]]*\])?\{[^}]*\}\s*$/;
const SETUP_LINE = /^\s*\\(?:usetikzlibrary|usepgfplotslibrary|pgfplotsset)\{[^}]*\}\s*$/;

export function isFullDocument(latex: string): boolean {
  return /\\documentclass\b/.test(latex);
}

function stripFences(latex: string): string {
  const trimmed = latex.trim();
  const fenced = trimmed.match(/^```(?:latex|tex)?\s*\n([\s\S]*?)\n```$/);
  return fenced ? fenced[1] : trimmed;
}

function hoistPreamble(body: string) {
  const packages: string[] = [];
  const setup: string[] = [];
  const rest: string[] = [];
  let leading = true;
  for (const line of body.split('\n')) {
    if (PACKAGE_LINE.test(line)) {
      packages.push(line.trim());
      continue;
    }
    if (leading && SETUP_LINE.test(line)) {
      setup.push(line.trim());
      continue;
    }
    if (line.trim()) leading = false;
    rest.push(line);
  }
  return { body: rest.join('\n').trim(), packages, setup };
}

/**
 * The tools and www sites already wrap fragments before posting
 * (`wrapAsDocument` / `wrapLatexDocument`), so most drafts arrive as full
 * documents and pass through unchanged. Fragments posted straight to
 * /api/drafts get the same minimal `article` + amsmath/amssymb wrapper the
 * tools site uses. Only the preview is wrapped; the project created on
 * import keeps the draft verbatim.
 */
export function wrapForPreview(latex: string): string {
  const stripped = stripFences(latex.replace(/\r\n?/g, '\n'));
  if (!stripped) return stripped;
  if (isFullDocument(stripped)) return stripped;

  const { body, packages: hoistedPackages, setup: hoistedSetup } = hoistPreamble(stripped);
  const wanted = new Set<WrapPackage>();
  for (const [pkg, re] of DETECTORS) {
    if (re.test(body)) wanted.add(pkg);
  }
  if (wanted.has('pgfplots')) wanted.delete('tikz');

  const lines = ['\\documentclass{article}', '\\usepackage{amsmath}', '\\usepackage{amssymb}'];
  lines.push(...hoistedPackages);
  const alreadyLoaded = (pkg: WrapPackage) =>
    hoistedPackages.some((line) => new RegExp(`\\{[^}]*\\b${pkg}\\b[^}]*\\}\\s*$`).test(line));
  for (const pkg of PACKAGE_ORDER) {
    if (!wanted.has(pkg) || alreadyLoaded(pkg)) continue;
    lines.push(`\\usepackage{${pkg}}`);
    if (pkg === 'pgfplots') lines.push('\\pgfplotsset{compat=1.18}');
  }
  lines.push(...hoistedSetup);

  return `${lines.join('\n')}\n\n\\begin{document}\n\n${body}\n\n\\end{document}\n`;
}

// ---------------------------------------------------------------------------
// Documents the guest route never compiles
// ---------------------------------------------------------------------------

/**
 * The compile service turns on `-shell-escape` for most real documents
 * (services/compile/internal/helpers.go `requiresShellEscape` matches any
 * `\usepackage[`), so a document can run commands and read files on the
 * compile host. In the editor that sits behind a signed-in user; this route
 * has no user, so drafts that reach for those primitives are not previewed
 * at all (the editor still opens them after sign-up). Matched on the raw
 * source, with or without a backslash, so `\csname write18\endcsname` is
 * caught too. This is defence in depth, not a sandbox: the service-side fix
 * is to compile previews without shell escape.
 */
const PREVIEW_UNSUPPORTED_RE =
  /write18|ShellEscape|DelayedShellEscape|directlua|latelua|luaexec|luacode|luadirect|\\openin\b|\\openout\b|\\input\s*\{?\s*\||\\include\s*\{?\s*\||\\usepackage(?:\[[^\]]*\])?\{[^}]*\b(?:minted|pythontex|gnuplottex|asymptote|shellesc|luacode)\b|\\begin\{(?:minted|pycode|python|pyblock|pyconsole|gnuplot|asy)\b|\\inputminted\b|\\py[cs]?\{/;

/** True when the draft uses something the guest preview refuses to compile. */
export function isUnsupportedForPreview(latex: string): boolean {
  return PREVIEW_UNSUPPORTED_RE.test(latex);
}

// ---------------------------------------------------------------------------
// Compile-service credential
// ---------------------------------------------------------------------------

function base64url(input: string | Buffer): string {
  return Buffer.from(input).toString('base64url');
}

/**
 * A short-lived HS256 token for the compile service, which accepts any token
 * signed with the Supabase project's JWT secret (services/compile/main.go
 * `jwtAuthMiddleware`; no claim checks). Same shape as the one
 * tools/scripts/compile-templates.mjs mints.
 */
export function mintCompileServiceToken(secret: string, now = Date.now(), ttlSeconds = 120): string {
  const iat = Math.floor(now / 1000);
  const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = base64url(
    JSON.stringify({ iss: 'octree-app', sub: 'import-preview', role: 'service_role', iat, exp: iat + ttlSeconds })
  );
  const signature = createHmac('sha256', secret).update(`${header}.${payload}`).digest('base64url');
  return `${header}.${payload}.${signature}`;
}

/**
 * Credential for the compile service when there is no user session.
 * `SUPABASE_JWT_SECRET` (if the app has it) mints a 2-minute token; otherwise
 * the Supabase service-role key is used, which is itself an HS256 JWT signed
 * with that secret and is what the ops compile smoke test
 * (app/api/cron/health-check) already sends. Never a user's session.
 */
export interface CompileCredentialEnv {
  SUPABASE_JWT_SECRET?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
}

export function compileServiceToken(
  env: CompileCredentialEnv = process.env as CompileCredentialEnv,
  now = Date.now()
): string | null {
  if (env.SUPABASE_JWT_SECRET) return mintCompileServiceToken(env.SUPABASE_JWT_SECRET, now);
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (key && key.startsWith('ey')) return key;
  return null;
}

// ---------------------------------------------------------------------------
// Compile error summary
// ---------------------------------------------------------------------------

const TMP_PATH_RE = /\/tmp\/latex-[^/\s]+\//g;

/**
 * The first few error lines of a compile failure. LaTeX marks errors with a
 * leading `!`; the line after it usually names the offending input, so it is
 * kept too. Falls back to the service's message when the log has no `!` line.
 */
export function compileErrorSummary(
  body: { log?: string; stdout?: string; stderr?: string; message?: string; error?: string },
  maxLines = PREVIEW_ERROR_LINES
): string[] {
  const text = [body.log, body.stdout, body.stderr].filter(Boolean).join('\n');
  const lines = text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(TMP_PATH_RE, './').trimEnd());

  const picked: string[] = [];
  for (let i = 0; i < lines.length && picked.length < maxLines; i++) {
    const line = lines[i];
    if (!/^!/.test(line) && !/^(?:.*\.tex:\d+:|.*Error:)/.test(line)) continue;
    picked.push(line.trim());
    const next = lines[i + 1]?.trim();
    if (next && /^l\.\d+/.test(next) && picked.length < maxLines) {
      picked.push(next);
      i++;
    }
  }
  if (picked.length > 0) return picked;

  const fallback = (body.message || body.error || '').trim();
  return fallback ? [fallback.slice(0, 300)] : [];
}

// ---------------------------------------------------------------------------
// Draft loading
// ---------------------------------------------------------------------------

export type DraftLoadResult =
  | { ok: true; draft: PreviewDraft }
  | { ok: false; reason: 'not_found' | 'consumed' | 'expired' };

export async function loadPreviewDraft(
  admin: SupabaseClient<any, any, any>,
  draftId: string,
  now = Date.now()
): Promise<DraftLoadResult> {
  if (!isDraftId(draftId)) return { ok: false, reason: 'not_found' };

  const { data, error } = (await (admin.from('drafts') as any)
    .select('id, title, content, source, consumed_at, created_at')
    .eq('id', draftId)
    .maybeSingle()) as { data: PreviewDraft | null; error: unknown };

  if (error || !data) return { ok: false, reason: 'not_found' };
  if (data.consumed_at) return { ok: false, reason: 'consumed' };
  const createdAt = Date.parse(data.created_at);
  if (!Number.isFinite(createdAt) || now - createdAt > PREVIEW_MAX_AGE_MS) {
    return { ok: false, reason: 'expired' };
  }
  return { ok: true, draft: data };
}

// ---------------------------------------------------------------------------
// Compile
// ---------------------------------------------------------------------------

export type CompileOutcome =
  | { ok: true; pdf: Buffer }
  | { ok: false; reason: 'compile_failed'; errorLines: string[] }
  | { ok: false; reason: 'unavailable'; detail: string };

export interface CompileOptions {
  compileServiceUrl: string;
  token: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  /** Compile-service cache key; one per draft so retries hit its cache. */
  projectId?: string;
}

export async function compileForPreview(latex: string, options: CompileOptions): Promise<CompileOutcome> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? PREVIEW_COMPILE_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchImpl(`${options.compileServiceUrl.replace(/\/$/, '')}/compile`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${options.token}`,
      },
      body: JSON.stringify({
        files: [{ path: 'main.tex', content: latex }],
        projectId: options.projectId,
        lastModifiedFile: 'main.tex',
      }),
      signal: controller.signal,
    });

    if (response.ok) {
      const pdf = Buffer.from(await response.arrayBuffer());
      if (pdf.length === 0 || pdf.toString('utf8', 0, 4) !== '%PDF') {
        return { ok: false, reason: 'unavailable', detail: 'compile service returned a non-PDF body' };
      }
      return { ok: true, pdf };
    }

    const text = await response.text();
    let body: Record<string, unknown> = {};
    try {
      body = JSON.parse(text);
    } catch {
      body = { message: text };
    }

    // 500 is a LaTeX failure (services/compile CompileHandler); anything else
    // (401 bad credential, 503 queue full, 400) is the service, not the draft.
    if (response.status === 500) {
      return { ok: false, reason: 'compile_failed', errorLines: compileErrorSummary(body as any) };
    }
    return {
      ok: false,
      reason: 'unavailable',
      detail: `compile service returned ${response.status}: ${String(body.message ?? body.error ?? '').slice(0, 200)}`,
    };
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      return { ok: false, reason: 'unavailable', detail: `compile timed out after ${timeoutMs}ms` };
    }
    return { ok: false, reason: 'unavailable', detail: error instanceof Error ? error.message : String(error) };
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Storage cache (one compile per draft id, across instances)
// ---------------------------------------------------------------------------

type StorageClient = Pick<SupabaseClient<any, any, any>, 'storage'>;

function pdfPath(draftId: string) {
  return `${draftId}.pdf`;
}

function errorPath(draftId: string) {
  return `${draftId}.error.json`;
}

type CachedPreview = { kind: 'pdf'; pdf: Buffer } | { kind: 'error'; errorLines: string[] } | null;

async function readCachedPreview(admin: StorageClient, draftId: string): Promise<CachedPreview> {
  const bucket = admin.storage.from(PREVIEW_BUCKET);
  try {
    const { data: pdfBlob } = await bucket.download(pdfPath(draftId));
    if (pdfBlob) {
      const pdf = Buffer.from(await pdfBlob.arrayBuffer());
      if (pdf.length > 0) return { kind: 'pdf', pdf };
    }
    const { data: errorBlob } = await bucket.download(errorPath(draftId));
    if (errorBlob) {
      const parsed = JSON.parse(await errorBlob.text()) as { errorLines?: unknown };
      const errorLines = Array.isArray(parsed.errorLines) ? parsed.errorLines.map(String) : [];
      return { kind: 'error', errorLines };
    }
  } catch {
    // A missing bucket or object is a cache miss, never a failure.
  }
  return null;
}

async function writeCachedPreview(admin: StorageClient, draftId: string, outcome: CompileOutcome) {
  const bucket = admin.storage.from(PREVIEW_BUCKET);
  try {
    if (outcome.ok) {
      const { error } = await bucket.upload(pdfPath(draftId), outcome.pdf, {
        contentType: 'application/pdf',
        upsert: true,
      });
      if (error) console.warn('[import-preview] could not store preview PDF:', error.message);
    } else if (outcome.reason === 'compile_failed') {
      const { error } = await bucket.upload(
        errorPath(draftId),
        JSON.stringify({ errorLines: outcome.errorLines }),
        { contentType: 'application/json', upsert: true }
      );
      if (error) console.warn('[import-preview] could not store preview error:', error.message);
    }
    // `unavailable` (timeout, service down) is not cached: the next visit retries.
  } catch (error) {
    console.warn('[import-preview] storage write failed:', error);
  }
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

export interface RenderPreviewDeps {
  admin?: SupabaseClient<any, any, any>;
  fetchImpl?: typeof fetch;
  env?: CompileCredentialEnv & { COMPILE_SERVICE_URL?: string };
  now?: number;
  timeoutMs?: number;
}

// Concurrent requests for the same draft on one instance share a compile.
const globalForPreview = globalThis as unknown as {
  __octreeImportPreviewInflight__?: Map<string, Promise<PreviewResult>>;
};
const inflight =
  globalForPreview.__octreeImportPreviewInflight__ ??
  (globalForPreview.__octreeImportPreviewInflight__ = new Map());

export async function renderImportPreview(draftId: string, deps: RenderPreviewDeps = {}): Promise<PreviewResult> {
  const pending = inflight.get(draftId);
  if (pending) return pending;

  const run = renderImportPreviewUncached(draftId, deps).finally(() => {
    inflight.delete(draftId);
  });
  inflight.set(draftId, run);
  return run;
}

async function renderImportPreviewUncached(draftId: string, deps: RenderPreviewDeps): Promise<PreviewResult> {
  const now = deps.now ?? Date.now();
  const env = deps.env ?? (process.env as CompileCredentialEnv & { COMPILE_SERVICE_URL?: string });
  const admin = deps.admin ?? createAdminClient();

  const loaded = await loadPreviewDraft(admin, draftId, now);
  if (!loaded.ok) return { ok: false, reason: loaded.reason };
  const { draft } = loaded;

  const cached = await readCachedPreview(admin, draftId);
  if (cached?.kind === 'pdf') {
    return { ok: true, pdf: cached.pdf, cached: true, title: draft.title, source: draft.source };
  }
  if (cached?.kind === 'error') {
    return { ok: false, reason: 'compile_failed', errorLines: cached.errorLines, cached: true };
  }

  if (draft.content.length > PREVIEW_MAX_CONTENT_CHARS) {
    return { ok: false, reason: 'too_large' };
  }
  if (isUnsupportedForPreview(draft.content)) {
    return { ok: false, reason: 'unsupported' };
  }

  const compileServiceUrl = env.COMPILE_SERVICE_URL;
  const token = compileServiceToken(env, now);
  if (!compileServiceUrl || !token) {
    console.warn('[import-preview] COMPILE_SERVICE_URL or a compile credential is missing');
    return { ok: false, reason: 'unavailable' };
  }

  const outcome = await compileForPreview(wrapForPreview(draft.content), {
    compileServiceUrl,
    token,
    fetchImpl: deps.fetchImpl,
    timeoutMs: deps.timeoutMs,
    projectId: `import-preview-${draftId}`,
  });

  await writeCachedPreview(admin, draftId, outcome);

  if (outcome.ok) {
    return { ok: true, pdf: outcome.pdf, cached: false, title: draft.title, source: draft.source };
  }
  if (outcome.reason === 'compile_failed') {
    return { ok: false, reason: 'compile_failed', errorLines: outcome.errorLines, cached: false };
  }
  console.warn('[import-preview] compile unavailable:', outcome.detail);
  return { ok: false, reason: 'unavailable' };
}
