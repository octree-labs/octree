import { authenticateApiRequest } from '@/lib/api/auth';
import { runApiCompile } from '@/lib/api/compile';
import { validateApiCompileRequest } from '@/lib/api/compile-request';
import { apiJson, apiPdf, apiPreflight } from '@/lib/api/http';
import { captureServerExceptionAfterResponse } from '@/lib/posthog-server';

/**
 * POST /api/v1/compile: the public LaTeX compile API.
 *
 *   Authorization: Bearer oct_live_...
 *   { "latex": "..." } | { "files": [{ "path", "content" }], "main"? }, "response"?: "json" | "pdf"
 *
 * A LaTeX error is HTTP 200 with `ok: false`; 4xx/5xx are reserved for
 * request, auth, quota and service problems. Spec: GET /api/v1/openapi.json.
 * Reachable without a session: middleware.ts never redirects /api/*.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/** Bigger than the 2 MB source limit (JSON escaping, base64 images) but bounded. */
const MAX_BODY_BYTES = 4 * 1024 * 1024;

export async function OPTIONS() {
  return apiPreflight();
}

export async function GET() {
  return apiJson(
    {
      error: 'method_not_allowed',
      message: 'Use POST with a JSON body {"latex": "..."}; see https://app.useoctree.com/api/v1/openapi.json',
    },
    405,
    { Allow: 'POST, OPTIONS' }
  );
}

export async function POST(request: Request) {
  const auth = await authenticateApiRequest(request);
  if (!auth.ok) return auth.response;
  const { principal } = auth;

  try {
    const declared = Number(request.headers.get('content-length') ?? 0);
    if (declared > MAX_BODY_BYTES) {
      return apiJson({ error: 'payload_too_large', message: 'Request body is larger than 4 MB.' }, 413);
    }
    const text = await request.text();
    if (Buffer.byteLength(text, 'utf8') > MAX_BODY_BYTES) {
      return apiJson({ error: 'payload_too_large', message: 'Request body is larger than 4 MB.' }, 413);
    }
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      return apiJson({ error: 'invalid_request', message: 'Body is not valid JSON.' }, 400);
    }

    const acceptPdf = /\bapplication\/pdf\b/i.test(request.headers.get('accept') ?? '');
    const validation = validateApiCompileRequest(body, acceptPdf);
    if (!validation.ok) return apiJson(validation.error.body, validation.error.status);

    const outcome = await runApiCompile(principal, validation.request, 'rest');
    if (outcome.kind === 'error') return apiJson(outcome.body, outcome.status, outcome.headers);

    if (validation.request.response === 'pdf' && outcome.json.ok && outcome.pdf) {
      const headers: Record<string, string> = { 'X-Octree-Duration-Ms': String(outcome.json.duration_ms) };
      if (outcome.json.pages) headers['X-Octree-Pages'] = String(outcome.json.pages);
      return apiPdf(outcome.pdf, headers);
    }
    return apiJson(outcome.json, 200);
  } catch (error) {
    console.error('[api/v1/compile] unexpected error:', error);
    captureServerExceptionAfterResponse(error, { route: 'api/v1/compile', distinctId: principal.userId });
    return apiJson({ error: 'internal_error', message: 'Unexpected server error.' }, 500);
  }
}
