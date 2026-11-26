// @vitest-environment node
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createMemoryOAuthStore, type MemoryKey } from '@/tests/helpers/oauth-memory-store';

/** lib/oauth/flow.ts: codes, token exchange, refresh rotation, revocation; and the tokens on authenticateApiRequest. */

const mocks = vi.hoisted(() => ({ keys: [] as MemoryKey[] }));

// A tiny service-role client for lib/api/auth.ts: api_keys by hash, user_usage, auth user.
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from(table: string) {
      const filters: Record<string, unknown> = {};
      const builder: any = {
        select: () => builder,
        update: () => builder,
        eq: (column: string, value: unknown) => {
          filters[column] = value;
          return builder;
        },
        maybeSingle: async () => {
          if (table === 'api_keys') {
            const key = mocks.keys.find((k) => k.key_hash === filters.key_hash);
            return { data: key ? { ...key } : null, error: null };
          }
          return { data: null, error: null };
        },
        then: (resolve: (value: unknown) => void) => resolve({ error: null }),
      };
      return builder;
    },
    auth: { admin: { getUserById: async () => ({ data: { user: { email: 'a@example.com' } } }) } },
  }),
}));
vi.mock('@/lib/posthog-server', () => ({ afterResponse: () => undefined }));

import { authenticateApiRequest } from '@/lib/api/auth';
import { generateApiKey } from '@/lib/api/keys';
import type { ValidAuthorizeRequest } from '@/lib/oauth/authorize';
import {
  exchangeAuthorizationCode,
  issueAuthorizationCode,
  refreshAccessToken,
  revokeToken,
  type TokenSuccess,
} from '@/lib/oauth/flow';
import { MAX_ACTIVE_OAUTH_GRANTS } from '@/lib/oauth/metadata';
import { s256Challenge } from '@/lib/oauth/tokens';

const ORIGIN = 'https://app.useoctree.com';
const USER = '6f1c2b0e-0f0a-4c55-9a0e-2b8f2f4d1a11';
const CLIENT_ID = 'https://claude.ai/oauth/claude-code-client-metadata';
const VERIFIER = 'v'.repeat(43) + '-._~abc';
const T0 = Date.parse('2026-11-25T12:00:00Z');

const REQUEST: ValidAuthorizeRequest = {
  client: {
    client_id: CLIENT_ID,
    kind: 'cimd',
    client_name: 'Claude Code',
    redirect_uris: ['http://localhost/callback'],
    metadata_host: 'claude.ai',
  },
  redirectUri: 'http://localhost:3118/callback',
  codeChallenge: s256Challenge(VERIFIER),
  state: 'st',
  scope: 'compile offline_access',
  resource: `${ORIGIN}/api/mcp`,
  loopbackOnly: true,
};

let mem: ReturnType<typeof createMemoryOAuthStore>;
let ipCounter = 0;

beforeEach(() => {
  mem = createMemoryOAuthStore();
  mocks.keys = [];
});

async function code(now = T0): Promise<string> {
  const issued = await issueAuthorizationCode(mem.store, { request: REQUEST, userId: USER, now });
  if (!issued.ok) throw new Error('no code');
  return issued.code;
}

function exchange(c: string, patch: Record<string, unknown> = {}, now = T0 + 5_000) {
  return exchangeAuthorizationCode(mem.store, {
    code: c,
    clientId: CLIENT_ID,
    redirectUri: REQUEST.redirectUri,
    codeVerifier: VERIFIER,
    resource: `${ORIGIN}/api/mcp`,
    origin: ORIGIN,
    now,
    generateKey: generateApiKey,
    ...patch,
  });
}

function refresh(token: string, patch: Record<string, unknown> = {}, now = T0 + 60 * 60_000) {
  return refreshAccessToken(mem.store, {
    refreshToken: token,
    clientId: CLIENT_ID,
    scope: undefined,
    resource: undefined,
    origin: ORIGIN,
    now,
    generateKey: generateApiKey,
    ...patch,
  });
}

async function tokens(): Promise<TokenSuccess> {
  const result = await exchange(await code());
  if (!result.ok) throw new Error(result.description);
  return result.body;
}

function callApi(token: string) {
  ipCounter += 1;
  return authenticateApiRequest(
    new Request(`${ORIGIN}/api/mcp`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'x-forwarded-for': `10.9.0.${ipCounter}` },
    })
  );
}

describe('authorization code exchange', () => {
  it('issues an expiring API key and a refresh token', async () => {
    const body = await tokens();
    expect(body).toMatchObject({ token_type: 'Bearer', expires_in: 3600, scope: 'compile offline_access' });
    expect(body.access_token).toMatch(/^oct_live_[A-Za-z0-9_-]{32}$/);
    expect(body.refresh_token).toMatch(/^oct_rt_/);
    const [key] = mem.keys.values();
    expect(key).toMatchObject({ kind: 'oauth', user_id: USER, name: 'Claude Code (OAuth)' });
    expect(Date.parse(key.expires_at!)).toBe(T0 + 5_000 + 3600_000);
    expect([...mem.grants.values()][0]).toMatchObject({ client_id: CLIENT_ID, client_kind: 'cimd', scope: 'compile offline_access' });
  });

  it('is single use, and a replayed code revokes what it produced', async () => {
    const c = await code();
    const first = await exchange(c);
    expect(first.ok).toBe(true);
    const second = await exchange(c);
    expect(second).toMatchObject({ ok: false, error: 'invalid_grant' });
    const [grant] = mem.grants.values();
    expect(grant.revoked_at).not.toBeNull();
    expect(grant.revoked_reason).toBe('code_reuse');
    expect([...mem.keys.values()].every((k) => k.revoked_at)).toBe(true);
  });

  it('expires after 60 seconds', async () => {
    const c = await code();
    expect(await exchange(c, {}, T0 + 61_000)).toMatchObject({ ok: false, error: 'invalid_grant' });
  });

  it('checks PKCE, client_id and redirect_uri (and burns the code on failure)', async () => {
    expect(await exchange(await code(), { codeVerifier: 'w'.repeat(43) })).toMatchObject({ ok: false, error: 'invalid_grant' });
    expect(await exchange(await code(), { clientId: 'https://evil.example/meta' })).toMatchObject({ ok: false, error: 'invalid_grant' });
    expect(await exchange(await code(), { redirectUri: 'http://localhost:9999/callback' })).toMatchObject({
      ok: false,
      error: 'invalid_grant',
    });
    const c = await code();
    expect((await exchange(c, { codeVerifier: 'w'.repeat(43) })).ok).toBe(false);
    expect((await exchange(c)).ok).toBe(false);
    expect(mem.grants.size).toBe(0);
  });

  it('requires the parameters and a matching resource', async () => {
    const c = await code();
    expect(await exchange(c, { codeVerifier: undefined })).toMatchObject({ error: 'invalid_request' });
    expect(await exchange(c, { redirectUri: undefined })).toMatchObject({ error: 'invalid_request' });
    expect(await exchange(c, { resource: 'https://other.example/mcp' })).toMatchObject({ error: 'invalid_target' });
    expect(await exchange('oct_ac_' + 'x'.repeat(43))).toMatchObject({ error: 'invalid_grant' });
  });

  it('caps active connections per user', async () => {
    for (let i = 0; i < MAX_ACTIVE_OAUTH_GRANTS; i++) await tokens();
    expect(await issueAuthorizationCode(mem.store, { request: REQUEST, userId: USER, now: T0 })).toEqual({ ok: false, reason: 'limit' });
  });
});

describe('refresh', () => {
  it('rotates: new access + refresh token, old refresh token spent', async () => {
    const first = await tokens();
    const next = await refresh(first.refresh_token);
    expect(next.ok).toBe(true);
    if (!next.ok) return;
    expect(next.body.refresh_token).not.toBe(first.refresh_token);
    expect(next.body.access_token).not.toBe(first.access_token);
    expect(mem.keys.size).toBe(2);
    expect([...mem.grants.values()][0].last_refreshed_at).not.toBeNull();
    // The new refresh token works in turn.
    expect((await refresh(next.body.refresh_token, {}, T0 + 2 * 3600_000)).ok).toBe(true);
  });

  it('detects reuse: the old token revokes the whole grant, including the newest tokens', async () => {
    const first = await tokens();
    const next = await refresh(first.refresh_token);
    if (!next.ok) throw new Error('refresh failed');
    expect(await refresh(first.refresh_token)).toMatchObject({ ok: false, error: 'invalid_grant' });
    const [grant] = mem.grants.values();
    expect(grant.revoked_reason).toBe('refresh_reuse');
    expect(await refresh(next.body.refresh_token)).toMatchObject({ ok: false, error: 'invalid_grant' });
    expect([...mem.keys.values()].every((k) => k.revoked_at)).toBe(true);
  });

  it('refuses another client, a wider scope, an expired or unknown token', async () => {
    const first = await tokens();
    expect(await refresh(first.refresh_token, { clientId: 'other' })).toMatchObject({ error: 'invalid_grant' });
    expect(await refresh(first.refresh_token, { scope: 'compile admin' })).toMatchObject({ error: 'invalid_scope' });
    expect(await refresh(first.refresh_token, {}, T0 + 61 * 24 * 3600_000)).toMatchObject({ error: 'invalid_grant' });
    expect(await refresh('oct_rt_' + 'q'.repeat(43))).toMatchObject({ error: 'invalid_grant' });
    expect(await refresh('not-a-token')).toMatchObject({ error: 'invalid_grant' });
    // A narrower (equal) scope is fine.
    expect((await refresh(first.refresh_token, { scope: 'compile' })).ok).toBe(true);
  });
});

describe('revocation (RFC 7009)', () => {
  it('revokes the grant for a refresh token', async () => {
    const body = await tokens();
    expect(await revokeToken(mem.store, { token: body.refresh_token, clientId: CLIENT_ID, now: T0 })).toMatchObject({ revoked: 'grant' });
    expect(await refresh(body.refresh_token)).toMatchObject({ error: 'invalid_grant' });
    expect([...mem.keys.values()][0].revoked_at).not.toBeNull();
  });

  it('revokes only that token for an access token, and ignores other clients and unknown tokens', async () => {
    const body = await tokens();
    expect(await revokeToken(mem.store, { token: body.access_token, clientId: 'someone-else', now: T0 })).toEqual({ revoked: null });
    expect(await revokeToken(mem.store, { token: body.access_token, clientId: CLIENT_ID, now: T0 })).toMatchObject({
      revoked: 'access_token',
    });
    expect([...mem.grants.values()][0].revoked_at).toBeNull();
    expect(await revokeToken(mem.store, { token: generateApiKey(), clientId: undefined, now: T0 })).toEqual({ revoked: null });
    expect(await revokeToken(mem.store, { token: 'garbage', clientId: undefined, now: T0 })).toEqual({ revoked: null });
  });
});

describe('access tokens on the API (lib/api/auth.ts)', () => {
  it('authenticates a fresh token as an OAuth principal', async () => {
    vi.useFakeTimers({ now: T0 + 10_000, toFake: ['Date'] });
    try {
      const body = await tokens();
      mocks.keys = [...mem.keys.values()];
      const auth = await callApi(body.access_token);
      expect(auth).toMatchObject({ ok: true, principal: { userId: USER, plan: 'free', authMethod: 'oauth' } });
    } finally {
      vi.useRealTimers();
    }
  });

  it('rejects an expired token with 401 invalid_token and resource_metadata', async () => {
    vi.useFakeTimers({ now: T0 + 2 * 3600_000, toFake: ['Date'] });
    try {
      const body = await tokens();
      mocks.keys = [...mem.keys.values()].map((k) => ({ ...k, expires_at: new Date(T0).toISOString() }));
      const auth = await callApi(body.access_token);
      expect(auth.ok).toBe(false);
      if (auth.ok) return;
      expect(auth.response.status).toBe(401);
      const challenge = auth.response.headers.get('www-authenticate')!;
      expect(challenge).toContain('error="invalid_token"');
      expect(challenge).toContain(`resource_metadata="${ORIGIN}/.well-known/oauth-protected-resource"`);
    } finally {
      vi.useRealTimers();
    }
  });

  it('rejects a revoked OAuth token', async () => {
    const body = await tokens();
    await revokeToken(mem.store, { token: body.refresh_token, clientId: CLIENT_ID, now: T0 });
    mocks.keys = [...mem.keys.values()];
    const auth = await callApi(body.access_token);
    expect(auth.ok).toBe(false);
    if (!auth.ok) expect(auth.response.status).toBe(401);
  });

  it('answers a request without credentials with the discovery challenge', async () => {
    const auth = await authenticateApiRequest(new Request(`${ORIGIN}/api/mcp`, { method: 'POST' }));
    expect(auth.ok).toBe(false);
    if (auth.ok) return;
    expect(auth.response.status).toBe(401);
    expect(auth.response.headers.get('www-authenticate')).toBe(
      `Bearer realm="octree", resource_metadata="${ORIGIN}/.well-known/oauth-protected-resource", scope="compile"`
    );
    expect(await auth.response.json()).toMatchObject({ device_authorization_endpoint: expect.any(String) });
  });
});
