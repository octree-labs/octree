/* eslint-disable @typescript-eslint/no-explicit-any */
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

const allowedOrigin = process.env.ALLOWED_TOOLS_ORIGIN || 'https://tools.useoctree.com';

function withCors(response: NextResponse) {
  response.headers.set('Access-Control-Allow-Origin', allowedOrigin);
  response.headers.set('Access-Control-Allow-Credentials', 'true');
  response.headers.set('Access-Control-Allow-Headers', 'Content-Type');
  response.headers.set('Access-Control-Allow-Methods', 'GET, HEAD, POST, OPTIONS');
  return response;
}

export async function OPTIONS() {
  return withCors(NextResponse.json({}, { status: 204 }));
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
    const redirectUrl = new URL(`/import?draft=${encodeURIComponent(data.id)}`, url.origin);
    const res = NextResponse.redirect(redirectUrl, { status: 303 });
    // For top-level navigation initiated by form POST, CORS headers are not required, but harmless
    return withCors(res);
  } catch (err) {
    console.error('Draft error:', err);
    return withCors(NextResponse.json({ error: 'Internal Server Error' }, { status: 500 }));
  }
} 