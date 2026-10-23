/* eslint-disable @typescript-eslint/no-explicit-any */
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { importPath, setPendingDraftCookie } from '@/lib/import/pending-draft';
import { clientIp, createRateLimiter } from '@/lib/import/rate-limit';
import { captureServerExceptionAfterResponse } from '@/lib/posthog-server';
import { appendUtmParams } from '@/lib/utm';

const allowedOrigin = process.env.ALLOWED_TOOLS_ORIGIN || 'https://tools.useoctree.com';

/**
 * Drafts are anonymous rows and each one can be compiled once by the guest
 * preview route (app/api/import/preview), so a flood of drafts is a flood of
 * compiles. A visitor posts one draft per click; 20/min per IP is generous.
 * Per process (see lib/import/rate-limit.ts), like the preview limiter.
 */
const DRAFT_RATE_LIMIT = { limit: 20, windowMs: 60_000 };
/** Largest draft stored (chars). The biggest tools/www templates are well under 100 KB. */
const DRAFT_MAX_CONTENT_CHARS = 200_000;

const globalForLimiter = globalThis as unknown as {
  __octreeDraftsLimiter__?: ReturnType<typeof createRateLimiter>;
};
const limiter =
  globalForLimiter.__octreeDraftsLimiter__ ??
  (globalForLimiter.__octreeDraftsLimiter__ = createRateLimiter(DRAFT_RATE_LIMIT));

function withCors(response: NextResponse) {
  response.headers.set('Access-Control-Allow-Origin', allowedOrigin);
  response.headers.set('Access-Control-Allow-Credentials', 'true');
  response.headers.set('Access-Control-Allow-Headers', 'Content-Type');
  response.headers.set('Access-Control-Allow-Methods', 'GET, HEAD, POST, OPTIONS');
  return response;
}

export async function OPTIONS() {
  // 204 must have no body (the Response constructor throws otherwise).
  return withCors(new NextResponse(null, { status: 204 }));
}

export async function GET(request: NextRequest) {
  // Return No Content for accidental GETs to avoid noisy logs
  const res = new NextResponse(null, { status: 204 });
  return withCors(res);
}

export async function HEAD(request: NextRequest) {
  // Mirror GET behavior for HEAD requests
  const res = new NextResponse(null, { status: 204 });
  return withCors(res);
}

export async function POST(request: NextRequest) {
  try {
    const decision = limiter.check(clientIp(request.headers));
    if (!decision.allowed) {
      return withCors(
        NextResponse.json(
          { error: 'Too many requests' },
          { status: 429, headers: { 'Retry-After': String(decision.retryAfterSeconds) } }
        )
      );
    }

    const contentType = request.headers.get('content-type') || '';

    let content = '';
    let title = 'Imported from Tools';
    let source: string | null = null;

    if (contentType.includes('multipart/form-data') || contentType.includes('application/x-www-form-urlencoded')) {
      const form = await request.formData();
      content = (form.get('content') as string) || '';
      title = ((form.get('title') as string) || title).slice(0, 120);
      source = (form.get('source') as string) || null;
    } else {
      // Fallback to JSON
      const body = await request.json();
      content = body.content || '';
      title = (body.title || title).slice(0, 120);
      source = body.source || null;
    }

    if (!content) {
      return withCors(NextResponse.json({ error: 'Missing content' }, { status: 400 }));
    }
    if (typeof content !== 'string' || content.length > DRAFT_MAX_CONTENT_CHARS) {
      return withCors(NextResponse.json({ error: 'Draft too large' }, { status: 413 }));
    }

    const supabase = await createClient();

    // Store draft anonymously (no user required). It will be consumed after login.
    const { data, error } = await supabase
      .from('drafts' as any)
      .insert({ content, title, source })
      .select('id')
      .single();

    if (error || !data) {
      console.error('Draft insert error:', error);
      return withCors(NextResponse.json({ error: 'Failed to store draft' }, { status: 500 }));
    }

    const url = new URL(request.url);
    // Keep the tools' utm_* params: the 303 drops this POST's query, and
    // PostHog only records campaign params seen on the app's own first pageview.
    const redirectUrl = appendUtmParams(new URL(importPath(data.id), url.origin), url.searchParams);
    const res = NextResponse.redirect(redirectUrl, { status: 303 });
    // Remember the draft across sign-up / login so the import survives auth
    // paths that drop the `next` param (OAuth, email confirmation, homepage).
    setPendingDraftCookie(res, data.id);
    // For top-level navigation initiated by form POST, CORS headers are not required, but harmless
    return withCors(res);
  } catch (err) {
    console.error('Draft error:', err);
    captureServerExceptionAfterResponse(err, { route: 'api/drafts' });
    return withCors(NextResponse.json({ error: 'Internal Server Error' }, { status: 500 }));
  }
} 