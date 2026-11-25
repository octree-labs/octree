import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * /api/search (Exa) and /api/octra-agent/image-to-latex (OpenAI) spend paid
 * API credits on every call. They must refuse anonymous requests before any
 * upstream call is made, and cap each user's request rate.
 */

const mocks = vi.hoisted(() => ({ getUser: vi.fn() }));

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { getUser: mocks.getUser } }),
}));

const fetchMock = vi.fn();

function jsonRequest(path: string, body: unknown) {
  return new NextRequest(`https://app.useoctree.com${path}`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.stubGlobal('fetch', fetchMock);
  vi.stubEnv('EXA_API_KEY', 'test-exa-key');
  vi.stubEnv('OPENAI_API_KEY', 'test-openai-key');
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('POST /api/search', () => {
  const call = async () => {
    const { POST } = await import('@/app/api/search/route');
    return POST(jsonRequest('/api/search', { query: 'transformers' }));
  };

  it('returns 401 without a user and does not call Exa', async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null } });

    const res = await call();

    expect(res.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('calls Exa for a signed-in user', async () => {
    mocks.getUser.mockResolvedValue({ data: { user: { id: 'user-1' } } });
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ results: [] }), { status: 200 }));

    const res = await call();

    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledWith('https://api.exa.ai/search', expect.anything());
  });

  it('returns 429 once a user exceeds the per-minute cap', async () => {
    mocks.getUser.mockResolvedValue({ data: { user: { id: 'user-1' } } });
    fetchMock.mockImplementation(
      async () => new Response(JSON.stringify({ results: [] }), { status: 200 })
    );
    const { POST } = await import('@/app/api/search/route');

    const statuses: number[] = [];
    for (let i = 0; i < 31; i++) {
      statuses.push((await POST(jsonRequest('/api/search', { query: 'q' }))).status);
    }

    expect(statuses.slice(0, 30).every((s) => s === 200)).toBe(true);
    expect(statuses[30]).toBe(429);
    expect(fetchMock).toHaveBeenCalledTimes(30);
  });
});

describe('POST /api/octra-agent/image-to-latex', () => {
  const call = async () => {
    const { POST } = await import('@/app/api/octra-agent/image-to-latex/route');
    return POST(
      jsonRequest('/api/octra-agent/image-to-latex', {
        image: 'data:image/png;base64,AAAA',
        fileName: 'a.png',
      })
    );
  };

  it('returns 401 without a user and does not call OpenAI', async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null } });

    const res = await call();

    expect(res.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('calls OpenAI for a signed-in user', async () => {
    mocks.getUser.mockResolvedValue({ data: { user: { id: 'user-1' } } });
    fetchMock.mockResolvedValue(new Response('data: [DONE]\n\n', { status: 200 }));

    const res = await call();

    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.openai.com/v1/chat/completions',
      expect.anything()
    );
  });
});
