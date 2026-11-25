// @vitest-environment node
import { describe, it, expect, beforeEach, vi } from 'vitest';

/** lib/api/auth.ts: the 401 challenge and OAuth tokens resolving to the shared ApiPrincipal. */

const mocks = vi.hoisted(() => ({
  verify: vi.fn(),
  getUserById: vi.fn(),
  maybeSingle: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/api/oauth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api/oauth')>()),
  verifyOAuthAccessToken: mocks.verify,
}));
vi.mock('@/lib/posthog-server', () => ({ afterResponse: vi.fn() }));
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    auth: { admin: { getUserById: mocks.getUserById } },
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: mocks.maybeSingle }) }) }),
  }),
}));

import { authenticateApiRequest } from '@/lib/api/auth';

const USER = '6f1c2b0e-0f0a-4c55-9a0e-2b8f2f4d1a11';
let counter = 0;
/** A distinct JWT-shaped token per test (principals are cached by token). */
function token(): string {
  counter += 1;
  return `eyJhbGciOiJFUzI1NiJ9.eyJzdWIiOiJ${counter}x.c2ln${counter}`;
}

function request(authorization?: string) {
  return new Request('https://app.useoctree.com/api/mcp', {
    method: 'POST',
    headers: authorization ? { Authorization: authorization } : {},
  });
}

describe('authenticateApiRequest', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://abcd.supabase.co');
    mocks.getUserById.mockResolvedValue({ data: { user: { email: 'a@example.com' } } });
    mocks.maybeSingle.mockResolvedValue({ data: null });
  });

  it('answers a missing token with 401 and the resource_metadata challenge (realm kept)', async () => {
    const result = await authenticateApiRequest(request());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.response.status).toBe(401);
    expect(result.response.headers.get('www-authenticate')).toBe(
      'Bearer realm="octree", resource_metadata="https://app.useoctree.com/.well-known/oauth-protected-resource", scope="email"'
    );
  });

  it('resolves a valid OAuth token to an oauth principal with its plan', async () => {
    mocks.verify.mockResolvedValue({
      ok: true,
      claims: { userId: USER, clientId: 'client-123', expiresAt: Date.now() + 3_600_000, scope: null },
    });
    mocks.maybeSingle.mockResolvedValue({
      data: { subscription_status: 'active', stripe_subscription_id: 'sub_1', current_period_end: '2099-01-01T00:00:00Z' },
    });
    const t = token();
    const result = await authenticateApiRequest(request(`Bearer ${t}`));
    expect(result).toEqual({
      ok: true,
      principal: { userId: USER, keyId: null, plan: 'pro', authMethod: 'oauth', clientId: 'client-123' },
    });
    expect(mocks.verify).toHaveBeenCalledWith(t, {
      issuer: 'https://abcd.supabase.co/auth/v1',
      resource: 'https://app.useoctree.com/api/mcp',
      now: expect.any(Number),
    });
    // Cached for the next call.
    await authenticateApiRequest(request(`Bearer ${t}`));
    expect(mocks.verify).toHaveBeenCalledTimes(1);
  });

  it('answers a refused OAuth token with 401 invalid_token so the client refreshes', async () => {
    mocks.verify.mockResolvedValue({ ok: false, reason: 'expired', message: 'The access token has expired. Refresh it and retry.' });
    const result = await authenticateApiRequest(request(`Bearer ${token()}`));
    if (result.ok) throw new Error('expected a refusal');
    expect(result.response.status).toBe(401);
    expect(result.response.headers.get('www-authenticate')).toMatch(/resource_metadata=".+", scope="email", error="invalid_token"/);
    expect((await result.response.json()).message).toMatch(/expired/);
  });

  it('never rate-limits OAuth failures per IP (shared MCP host IPs)', async () => {
    mocks.verify.mockResolvedValue({ ok: false, reason: 'invalid', message: 'nope' });
    for (let i = 0; i < 15; i++) {
      const result = await authenticateApiRequest(request(`Bearer ${token()}`));
      if (result.ok) throw new Error('expected a refusal');
      expect(result.response.status).toBe(401);
    }
  });

  it('still treats oct_ tokens as API keys', async () => {
    const result = await authenticateApiRequest(request('Bearer oct_live_short'));
    if (result.ok) throw new Error('expected a refusal');
    expect((await result.response.json()).message).toMatch(/Malformed API key/);
    expect(mocks.verify).not.toHaveBeenCalled();
  });
});
