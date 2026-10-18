import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * app/api/email/unsubscribe/route.ts serves two link formats. These tests
 * pin that nothing is written without a matching token (link scanners
 * prefetch GETs), that both token paths opt the right record out, and that
 * the RFC 8058 one-click POST behaves like the GET.
 */

const mocks = vi.hoisted(() => {
  const upserts: Array<{ table: string; row: Record<string, unknown> }> = [];
  const getUserById = vi.fn();
  const from = vi.fn((table: string) => ({
    upsert: vi.fn(async (row: Record<string, unknown>) => {
      upserts.push({ table, row });
      return { error: null };
    }),
  }));
  return { upserts, getUserById, from };
});

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({ from: mocks.from, auth: { admin: { getUserById: mocks.getUserById } } }),
}));

import { GET, POST } from '@/app/api/email/unsubscribe/route';
import { createUserUnsubscribeToken, generateUnsubscribeToken } from '@/lib/email/unsubscribe';

const SECRET = 'unsubscribe-secret';
const USER_ID = '3f3a8d1e-7c7b-4d2a-9d33-1a2b3c4d5e6f';
const EMAIL = 'Person@Example.com';
const BASE = 'https://app.example.com/api/email/unsubscribe';

function request(query: string, method: 'GET' | 'POST' = 'GET') {
  return new Request(`${BASE}${query}`, {
    method,
    ...(method === 'POST'
      ? { headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'List-Unsubscribe=One-Click' }
      : {}),
  });
}

describe('unsubscribe route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.upserts.length = 0;
    vi.stubEnv('EMAIL_UNSUBSCRIBE_SECRET', SECRET);
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://app.example.com');
    mocks.getUserById.mockResolvedValue({ data: { user: { id: USER_ID, email: EMAIL } }, error: null });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('a bare GET writes nothing', async () => {
    expect((await GET(request(''))).status).toBe(400);
    expect((await GET(request(`?email=${encodeURIComponent(EMAIL)}`))).status).toBe(400);
    expect(mocks.upserts).toEqual([]);
  });

  it('a wrong token writes nothing on either path', async () => {
    expect((await GET(request('?token=not-a-token'))).status).toBe(403);
    const forged = `${Buffer.from(USER_ID).toString('base64url')}.${'a'.repeat(43)}`;
    expect((await GET(request(`?token=${forged}`))).status).toBe(403);
    const wrongSecret = createUserUnsubscribeToken(USER_ID, 'other');
    expect((await GET(request(`?token=${encodeURIComponent(wrongSecret)}`))).status).toBe(403);
    expect((await GET(request(`?email=${encodeURIComponent(EMAIL)}&token=deadbeef`))).status).toBe(403);
    expect(mocks.upserts).toEqual([]);
    expect(mocks.getUserById).not.toHaveBeenCalled();
  });

  it('a user token opts the user out and suppresses their current address', async () => {
    const token = createUserUnsubscribeToken(USER_ID, SECRET);
    const response = await GET(request(`?token=${encodeURIComponent(token)}`));
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/html');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.text()).toContain("You're unsubscribed");
    expect(mocks.getUserById).toHaveBeenCalledWith(USER_ID);
    expect(mocks.upserts).toEqual([
      {
        table: 'email_preferences',
        row: expect.objectContaining({ user_id: USER_ID, marketing_opt_out: true }),
      },
      { table: 'email_suppressions', row: { email: 'person@example.com' } },
    ]);
  });

  it('the one-click POST behaves like the GET', async () => {
    const token = createUserUnsubscribeToken(USER_ID, SECRET);
    const response = await POST(request(`?token=${encodeURIComponent(token)}`, 'POST'));
    expect(response.status).toBe(200);
    expect(mocks.upserts.map((u) => u.table)).toEqual(['email_preferences', 'email_suppressions']);
  });

  it('a deleted account is reported as done without a write', async () => {
    mocks.getUserById.mockResolvedValue({ data: { user: null }, error: { message: 'not found' } });
    const token = createUserUnsubscribeToken(USER_ID, SECRET);
    expect((await GET(request(`?token=${encodeURIComponent(token)}`))).status).toBe(200);
    expect(mocks.upserts).toEqual([]);
  });

  it('a legacy email token suppresses the address and redirects', async () => {
    const token = generateUnsubscribeToken(EMAIL);
    const response = await GET(request(`?email=${encodeURIComponent(EMAIL)}&token=${token}`));
    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe('https://app.example.com/unsubscribed');
    expect(mocks.upserts).toEqual([{ table: 'email_suppressions', row: { email: 'person@example.com' } }]);
  });

  it('the legacy path refuses when the secret is not configured', async () => {
    vi.stubEnv('EMAIL_UNSUBSCRIBE_SECRET', '');
    expect((await GET(request(`?email=${encodeURIComponent(EMAIL)}&token=abc`))).status).toBe(403);
    expect(mocks.upserts).toEqual([]);
  });
});
