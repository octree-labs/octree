import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createRateLimiter } from '@/lib/import/rate-limit';

export const runtime = 'nodejs';

// Every request is a paid Exa call: signed-in users only, and a per-user cap
// well above what the search panel sends by hand.
const searchLimiter = createRateLimiter({ limit: 30, windowMs: 60_000 });

interface ExaResult {
  title: string;
  url: string;
  publishedDate?: string;
  author?: string;
  text?: string;
  highlights?: string[];
}

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const limit = searchLimiter.check(user.id);
    if (!limit.allowed) {
      return NextResponse.json(
        { error: 'Too many searches. Please wait a moment and try again.' },
        { status: 429, headers: { 'Retry-After': String(limit.retryAfterSeconds) } }
      );
    }

    const apiKey = process.env.EXA_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: 'EXA_API_KEY is not configured' },
        { status: 503 }
      );
    }

    const { query } = await request.json();

    if (!query || typeof query !== 'string' || !query.trim()) {
      return NextResponse.json(
        { error: 'A search query is required' },
        { status: 400 }
      );
    }

    const res = await fetch('https://api.exa.ai/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
      },
      body: JSON.stringify({
        query: query.trim(),
        type: 'auto',
        numResults: 10,
        contents: {
          text: { maxCharacters: 300 },
          highlights: { numSentences: 2 },
        },
        category: 'research paper',
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      console.error('[Exa Search] API error:', res.status, err);
      return NextResponse.json(
        { error: 'Search failed' },
        { status: 502 }
      );
    }

    const data = await res.json();

    const results = (data.results || []).map((r: ExaResult) => ({
      title: r.title || 'Untitled',
      url: r.url,
      publishedDate: r.publishedDate || null,
      author: r.author || null,
      snippet: r.highlights?.[0] || r.text || '',
    }));

    return NextResponse.json({ results });
  } catch (error) {
    console.error('[Exa Search] Error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
