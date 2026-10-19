import { NextResponse } from 'next/server';
import { isDraftId } from '@/lib/import/pending-draft';
import { renderImportPreview, type PreviewResult } from '@/lib/import/preview';
import { clientIp, createRateLimiter } from '@/lib/import/rate-limit';
import { captureServerExceptionAfterResponse } from '@/lib/posthog-server';

/**
 * GET /api/import/preview/<draftId>
 *
 * The compiled PDF of an unconsumed "Open in Octree" draft, for the
 * logged-out landing at /import/start. No session is required: the draft id
 * is an unguessable uuid the visitor was given by /api/drafts, and consumed
 * or expired drafts are 404 so a preview never outlives the import.
 *
 * Reachable logged out because middleware.ts never redirects `/api/*`.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// 20s compile timeout plus storage round trips.
export const maxDuration = 30;

// 10 previews per IP per minute; a legitimate visitor needs one.
const PREVIEW_RATE_LIMIT = { limit: 10, windowMs: 60_000 };

// One limiter per process (survives HMR and Fluid Compute instance reuse).
const globalForLimiter = globalThis as unknown as {
  __octreeImportPreviewLimiter__?: ReturnType<typeof createRateLimiter>;
};
const limiter =
  globalForLimiter.__octreeImportPreviewLimiter__ ??
  (globalForLimiter.__octreeImportPreviewLimiter__ = createRateLimiter(PREVIEW_RATE_LIMIT));

const BASE_HEADERS: Record<string, string> = {
  'X-Robots-Tag': 'noindex, nofollow',
  'X-Content-Type-Options': 'nosniff',
};

function json(body: Record<string, unknown>, status: number, extra: Record<string, string> = {}) {
  return NextResponse.json(body, {
    status,
    headers: { ...BASE_HEADERS, 'Cache-Control': 'private, no-store', ...extra },
  });
}

function failureResponse(result: Extract<PreviewResult, { ok: false }>) {
  switch (result.reason) {
    case 'not_found':
    case 'consumed':
    case 'expired':
      // Consumed and expired drafts look exactly like unknown ones.
      return json({ error: 'Draft not found' }, 404);
    case 'too_large':
      return json({ error: 'Draft too large to preview', reason: 'too_large' }, 422, {
        'Cache-Control': 'private, max-age=3600',
      });
    case 'compile_failed':
      return json(
        { error: 'Compile failed', reason: 'compile_failed', lines: result.errorLines ?? [] },
        422,
        { 'Cache-Control': 'private, max-age=3600' }
      );
    case 'unavailable':
    default:
      return json({ error: 'Preview unavailable', reason: 'unavailable' }, 503, { 'Retry-After': '30' });
  }
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ draftId: string }> }
) {
  const { draftId } = await params;
  if (!isDraftId(draftId)) {
    return json({ error: 'Draft not found' }, 404);
  }

  const decision = limiter.check(clientIp(request.headers));
  if (!decision.allowed) {
    return json({ error: 'Too many requests' }, 429, {
      'Retry-After': String(decision.retryAfterSeconds),
    });
  }

  try {
    const result = await renderImportPreview(draftId);
    if (!result.ok) return failureResponse(result);

    return new NextResponse(new Uint8Array(result.pdf), {
      status: 200,
      headers: {
        ...BASE_HEADERS,
        'Content-Type': 'application/pdf',
        'Content-Length': String(result.pdf.length),
        'Content-Disposition': 'inline; filename="preview.pdf"',
        'Cache-Control': 'private, max-age=3600',
        'X-Preview-Cache': result.cached ? 'hit' : 'miss',
      },
    });
  } catch (error) {
    console.error('[import-preview] unexpected failure:', error);
    captureServerExceptionAfterResponse(error, { route: 'api/import/preview' });
    return json({ error: 'Preview unavailable', reason: 'unavailable' }, 503, { 'Retry-After': '30' });
  }
}
