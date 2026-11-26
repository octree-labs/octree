// @vitest-environment node
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { createMemoryOAuthStore } from '@/tests/helpers/oauth-memory-store';

/** app/oauth/*: registration, consent page + decision, token, revoke; middleware and paywall exclusions. */

const mocks = vi.hoisted(() => ({
  store: null as any,
  getUser: vi.fn(),
  insertDcrClient: vi.fn(),
  resolveClient: vi.fn(),
  capture: vi.fn(),
  headers: new Headers({ host: 'app.useoctree.com', 'x-forwarded-proto': 'https' }),
}));

vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
}));
vi.mock('next/headers', () => ({ headers: async () => mocks.headers }));
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { getUser: mocks.getUser } }),
}));
vi.mock('@/lib/oauth/store', () => ({
  createOAuthStore: () => mocks.store,
  insertDcrClient: mocks.insertDcrClient,
  resolveClient: mocks.resolveClient,
}));
vi.mock('@/lib/posthog-server', () => ({
  captureServerEventAfterResponse: mocks.capture,
  captureServerExceptionAfterResponse: vi.fn(),
}));
vi.mock('@/components/icons/octree-logo', () => ({ OctreeLogo: () => null, OctreeWordmark: () => null }));

import * as registerRoute from '@/app/oauth/register/route';
import * as tokenRoute from '@/app/oauth/token/route';
import * as revokeRoute from '@/app/oauth/revoke/route';
import * as decisionRoute from '@/app/oauth/authorize/decision/route';
import AuthorizePage from '@/app/oauth/authorize/page';
import { config as middlewareConfig } from '@/middleware';
import { createConsentToken } from '@/lib/oauth/consent';
import { s256Challenge } from '@/lib/oauth/tokens';
import type { ClientInfo } from '@/lib/oauth/clients';

const ORIGIN = 'https://app.useoctree.com';
const USER = { id: '6f1c2b0e-0f0a-4c55-9a0e-2b8f2f4d1a11', email: 'a@example.com' };
const VERIFIER = 'k'.repeat(50);
const CLIENT: ClientInfo = {
  client_id: '0b6e3c1a-1111-4222-8333-944445555666',
  kind: 'dcr',
  client_name: 'Cursor',
  redirect_uris: ['cursor://anysphere.cursor-retrieval/oauth/callback'],
  metadata_host: null,
};
const PARAMS = {
  response_type: 'code',
  client_id: CLIENT.client_id,
  redirect_uri: CLIENT.redirect_uris[0],
  code_challenge: s256Challenge(VERIFIER),
  code_challenge_method: 'S256',
  state: 'state-123',
  scope: 'compile',
  resource: `${ORIGIN}/api/mcp`,
};

let mem: ReturnType<typeof createMemoryOAuthStore>;

beforeEach(() => {
  vi.clearAllMocks();
  mem = createMemoryOAuthStore();
  mocks.store = mem.store;
  mocks.getUser.mockResolvedValue({ data: { user: USER } });
  mocks.resolveClient.mockImplementation(async (id: string) =>
    id === CLIENT.client_id ? { ok: true, client: CLIENT } : { ok: false, reason: 'Unknown client_id.' }
  );
  process.env.OAUTH_CONSENT_SECRET = 'consent-secret';
});

function form(url: string, fields: Record<string, string>, headers: Record<string, string> = {}) {
  return new Request(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...headers },
    body: new URLSearchParams(fields).toString(),
  });
}

function decide(decision: string, overrides: Record<string, string> = {}, headers: Record<string, string> = { origin: ORIGIN }) {
  const fields = { ...PARAMS, decision, consent_token: createConsentToken('consent-secret', USER.id, PARAMS), ...overrides };
  return decisionRoute.POST(form(`${ORIGIN}/oauth/authorize/decision`, fields, headers));
}

async function approvedCode(): Promise<string> {
  const response = await decide('approve');
  expect(response.status).toBe(303);
  const location = new URL(response.headers.get('location')!);
  return location.searchParams.get('code')!;
}

async function page(params: Record<string, string>) {
  try {
    return renderToStaticMarkup(await AuthorizePage({ searchParams: Promise.resolve(params) }));
  } catch (error) {
    const message = (error as Error).message;
    if (message.startsWith('REDIRECT:')) return message;
    throw error;
  }
}

describe('POST /oauth/register', () => {
  it('registers a public client (201, no secret)', async () => {
    mocks.insertDcrClient.mockResolvedValue({ id: CLIENT.client_id, created_at: '2026-11-25T12:00:00Z' });
    const response = await registerRoute.POST(
      new Request(`${ORIGIN}/oauth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '203.0.113.7' },
        body: JSON.stringify({ client_name: 'Cursor', redirect_uris: CLIENT.redirect_uris, token_endpoint_auth_method: 'none' }),
      })
    );
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body).toMatchObject({ client_id: CLIENT.client_id, token_endpoint_auth_method: 'none', redirect_uris: CLIENT.redirect_uris });
    expect(body).not.toHaveProperty('client_secret');
    expect(mocks.insertDcrClient).toHaveBeenCalledWith(expect.objectContaining({ registration_ip: '203.0.113.7' }));
  });

  it('refuses bad metadata without writing', async () => {
    const response = await registerRoute.POST(
      new Request(`${ORIGIN}/oauth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '203.0.113.8' },
        body: JSON.stringify({ redirect_uris: ['http://evil.example/cb'] }),
      })
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: 'invalid_redirect_uri' });
    expect(mocks.insertDcrClient).not.toHaveBeenCalled();
  });

  it('rate-limits registrations per IP', async () => {
    mocks.insertDcrClient.mockResolvedValue({ id: CLIENT.client_id, created_at: '2026-11-25T12:00:00Z' });
    let last = 0;
    for (let i = 0; i < 31; i++) {
      const response = await registerRoute.POST(
        new Request(`${ORIGIN}/oauth/register`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '198.51.100.99' },
          body: JSON.stringify({ redirect_uris: CLIENT.redirect_uris }),
        })
      );
      last = response.status;
    }
    expect(last).toBe(429);
  });
});

describe('/oauth/authorize page', () => {
  it('sends signed-out visitors to login, keeping the request', async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null } });
    const result = await page(PARAMS);
    expect(result).toMatch(/^REDIRECT:\/auth\/login\?next=/);
    const next = decodeURIComponent(result.split('next=')[1]);
    expect(next.startsWith('/oauth/authorize?')).toBe(true);
    expect(new URLSearchParams(next.split('?')[1]).get('code_challenge')).toBe(PARAMS.code_challenge);
    expect(mocks.resolveClient).not.toHaveBeenCalled();
  });

  it('renders the consent screen: unverified name, destination, scope, account', async () => {
    const html = await page(PARAMS);
    expect(html).toContain('Allow Cursor to use your Octree account?');
    expect(html).toContain('has not verified it');
    expect(html).toContain('cursor://anysphere.cursor-retrieval');
    expect(html).toContain('cannot read or change your projects');
    expect(html).toContain('a@example.com');
    expect(html).toContain('action="/oauth/authorize/decision"');
    expect(html).toContain('name="consent_token"');
  });

  it('shows the metadata host for CIMD clients and warns on loopback-only redirects', async () => {
    const cimd: ClientInfo = {
      client_id: 'https://claude.ai/oauth/claude-code-client-metadata',
      kind: 'cimd',
      client_name: 'Claude Code',
      redirect_uris: ['http://localhost/callback'],
      metadata_host: 'claude.ai',
    };
    mocks.resolveClient.mockResolvedValue({ ok: true, client: cimd });
    const html = await page({ ...PARAMS, client_id: cimd.client_id, redirect_uri: 'http://localhost:4567/callback' });
    expect(html).toContain('published by <span class="font-medium text-neutral-800">claude.ai</span>');
    expect(html).toContain('localhost:4567');
    expect(html).toContain('any program on your computer');
  });

  it('shows client errors on the page, and protocol errors on the page with a link back (no auto-redirect)', async () => {
    expect(await page({ ...PARAMS, redirect_uri: 'https://evil.example/cb' })).toContain('Redirect address not registered');
    const html = await page({ ...PARAMS, code_challenge_method: 'plain' });
    expect(html).not.toMatch(/^REDIRECT:/);
    expect(html).toContain('This connection request is invalid');
    expect(html).toMatch(/href="cursor:\/\/anysphere\.cursor-retrieval\/oauth\/callback\?error=invalid_request/);
  });
});

describe('POST /oauth/authorize/decision', () => {
  it('approve redirects to the client with code, state and iss', async () => {
    const response = await decide('approve');
    expect(response.status).toBe(303);
    const location = new URL(response.headers.get('location')!);
    expect(location.protocol).toBe('cursor:');
    expect(location.searchParams.get('code')).toMatch(/^oct_ac_/);
    expect(location.searchParams.get('state')).toBe('state-123');
    expect(location.searchParams.get('iss')).toBe(ORIGIN);
    expect(mem.codes.size).toBe(1);
    expect(mocks.capture).toHaveBeenCalledWith(USER.id, 'oauth_authorized', expect.objectContaining({ client_kind: 'dcr' }));
  });

  it('deny redirects with access_denied and issues nothing', async () => {
    const response = await decide('deny');
    const location = new URL(response.headers.get('location')!);
    expect(location.searchParams.get('error')).toBe('access_denied');
    expect(location.searchParams.get('state')).toBe('state-123');
    expect(mem.codes.size).toBe(0);
  });

  it('refuses cross-site posts, bad tokens and tampered parameters', async () => {
    expect((await decide('approve', {}, { origin: 'https://evil.example' })).status).toBe(403);
    expect((await decide('approve', {}, {})).status).toBe(403);
    const badToken = await decide('approve', { consent_token: '1.x' });
    expect(badToken.headers.get('location')).toContain('octree_error=expired');
    // A token minted for other parameters does not approve these.
    const tampered = await decide('approve', { code_challenge: s256Challenge('z'.repeat(50)) });
    expect(tampered.headers.get('location')).toContain('octree_error=expired');
    expect(mem.codes.size).toBe(0);
  });

  it('sends a signed-out user to login', async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null } });
    const response = await decide('approve');
    expect(response.headers.get('location')).toContain('/auth/login?next=');
  });
});

describe('POST /oauth/token', () => {
  it('exchanges a code (form-urlencoded) and refreshes with rotation', async () => {
    const code = await approvedCode();
    const response = await tokenRoute.POST(
      form(`${ORIGIN}/oauth/token`, {
        grant_type: 'authorization_code',
        code,
        client_id: CLIENT.client_id,
        redirect_uri: CLIENT.redirect_uris[0],
        code_verifier: VERIFIER,
        resource: `${ORIGIN}/api/mcp`,
      })
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const body = await response.json();
    expect(body).toMatchObject({ token_type: 'Bearer', expires_in: 3600, scope: 'compile' });

    const refreshed = await tokenRoute.POST(
      form(`${ORIGIN}/oauth/token`, { grant_type: 'refresh_token', refresh_token: body.refresh_token, client_id: CLIENT.client_id })
    );
    expect(refreshed.status).toBe(200);
    const again = await tokenRoute.POST(
      form(`${ORIGIN}/oauth/token`, { grant_type: 'refresh_token', refresh_token: body.refresh_token, client_id: CLIENT.client_id })
    );
    expect(again.status).toBe(400);
    expect(await again.json()).toMatchObject({ error: 'invalid_grant' });
  });

  it('accepts JSON and client_id via Basic with an empty secret', async () => {
    const code = await approvedCode();
    const response = await tokenRoute.POST(
      new Request(`${ORIGIN}/oauth/token`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Basic ${Buffer.from(`${CLIENT.client_id}:`).toString('base64')}`,
        },
        body: JSON.stringify({ grant_type: 'authorization_code', code, redirect_uri: CLIENT.redirect_uris[0], code_verifier: VERIFIER }),
      })
    );
    expect(response.status).toBe(200);
  });

  it('answers RFC 6749 errors', async () => {
    const unsupported = await tokenRoute.POST(form(`${ORIGIN}/oauth/token`, { grant_type: 'client_credentials' }));
    expect(await unsupported.json()).toMatchObject({ error: 'unsupported_grant_type' });
    const secret = await tokenRoute.POST(
      form(`${ORIGIN}/oauth/token`, { grant_type: 'refresh_token', refresh_token: 'x' }, { Authorization: `Basic ${Buffer.from('a:b').toString('base64')}` })
    );
    expect(secret.status).toBe(401);
    expect(await secret.json()).toMatchObject({ error: 'invalid_client' });
    const missing = await tokenRoute.POST(form(`${ORIGIN}/oauth/token`, {}));
    expect(await missing.json()).toMatchObject({ error: 'invalid_request' });
  });
});

describe('POST /oauth/revoke', () => {
  it('always answers 200 and revokes refresh tokens', async () => {
    const code = await approvedCode();
    const tokens = await (
      await tokenRoute.POST(
        form(`${ORIGIN}/oauth/token`, {
          grant_type: 'authorization_code',
          code,
          client_id: CLIENT.client_id,
          redirect_uri: CLIENT.redirect_uris[0],
          code_verifier: VERIFIER,
        })
      )
    ).json();
    const revoked = await revokeRoute.POST(form(`${ORIGIN}/oauth/revoke`, { token: tokens.refresh_token, client_id: CLIENT.client_id }));
    expect(revoked.status).toBe(200);
    expect([...mem.grants.values()][0].revoked_at).not.toBeNull();
    expect((await revokeRoute.POST(form(`${ORIGIN}/oauth/revoke`, { token: 'unknown' }))).status).toBe(200);
    expect((await revokeRoute.POST(form(`${ORIGIN}/oauth/revoke`, {}))).status).toBe(400);
  });
});

describe('middleware and paywall', () => {
  const matcher = new RegExp(`^${middlewareConfig.matcher[0]}$`);

  it('skips the session middleware for discovery and the machine endpoints, not for the consent page', () => {
    for (const path of [
      '/.well-known/oauth-protected-resource',
      '/.well-known/oauth-protected-resource/api/mcp',
      '/.well-known/oauth-authorization-server',
      '/oauth/token',
      '/oauth/register',
      '/oauth/revoke',
    ]) {
      expect(matcher.test(path), path).toBe(false);
    }
    expect(matcher.test('/oauth/authorize')).toBe(true);
    expect(matcher.test('/oauth/authorize/decision')).toBe(true);
    expect(matcher.test('/oauth/tokenizer')).toBe(true);
  });

  it('never runs the onboarding paywall on /oauth', () => {
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const full = join(dir, name);
        if (statSync(full).isDirectory()) walk(full);
        else files.push(full);
      }
    };
    walk(join(process.cwd(), 'app/oauth'));
    expect(files.some((f) => /layout\.tsx?$/.test(f))).toBe(false);
    const gate = /from '@\/lib\/onboarding\/paywall-gate|enforceOnboardingPaywall\(/;
    for (const file of files) expect(readFileSync(file, 'utf8')).not.toMatch(gate);
    expect(readFileSync(join(process.cwd(), 'app/layout.tsx'), 'utf8')).not.toMatch(gate);
  });
});

describe('updateSession (lib/supabase/middleware.ts)', () => {
  it('does not bounce signed-out visitors away from OAuth paths, but still guards the app', async () => {
    vi.resetModules();
    vi.doMock('@supabase/ssr', () => ({
      createServerClient: () => ({ auth: { getUser: async () => ({ data: { user: null } }) } }),
    }));
    const { updateSession } = await import('@/lib/supabase/middleware');
    const { NextRequest } = await import('next/server');
    for (const path of ['/oauth/authorize?client_id=x', '/oauth/token', '/.well-known/oauth-authorization-server']) {
      const response = await updateSession(new NextRequest(`${ORIGIN}${path}`));
      expect(response.status, path).toBe(200);
    }
    const dashboard = await updateSession(new NextRequest(`${ORIGIN}/projects`));
    expect(dashboard.status).toBe(303);
    vi.doUnmock('@supabase/ssr');
  });
});
