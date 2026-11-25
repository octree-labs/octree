// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createMemoryDeviceStore } from '@/tests/helpers/device-memory-store';

/** app/api/v1/device/{code,token} and the 401 onboarding hints of lib/api/auth.ts. */

const holder = vi.hoisted(() => ({ store: null as any, capture: vi.fn() }));

vi.mock('@/lib/device/store', () => ({ createDeviceStore: () => holder.store }));
vi.mock('@/lib/posthog-server', () => ({
  afterResponse: vi.fn(),
  captureServerEventAfterResponse: holder.capture,
  captureServerExceptionAfterResponse: vi.fn(),
}));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({}) }));

import { POST as codePOST } from '@/app/api/v1/device/code/route';
import { POST as tokenPOST } from '@/app/api/v1/device/token/route';
import { approveDeviceAuthorization } from '@/lib/device/flow';
import { authenticateApiRequest } from '@/lib/api/auth';

let ipCounter = 0;
function freshIp() {
  ipCounter += 1;
  return `198.51.100.${ipCounter}`;
}

function json(url: string, body: unknown, ip = freshIp()) {
  return new Request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
    body: JSON.stringify(body),
  });
}

function form(url: string, fields: Record<string, string>, ip = freshIp()) {
  return new Request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-forwarded-for': ip },
    body: new URLSearchParams(fields).toString(),
  });
}

const CODE_URL = 'https://app.useoctree.com/api/v1/device/code';
const TOKEN_URL = 'https://app.useoctree.com/api/v1/device/token';
const GRANT = 'urn:ietf:params:oauth:grant-type:device_code';

let mem: ReturnType<typeof createMemoryDeviceStore>;

describe('POST /api/v1/device/code', () => {
  beforeEach(() => {
    mem = createMemoryDeviceStore();
    holder.store = mem.store;
    holder.capture.mockClear();
  });

  it('issues a code and reports device_code_issued without secrets', async () => {
    const response = await codePOST(json(CODE_URL, { client_name: 'Claude Code' }));
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const body = await response.json();
    expect(body).toMatchObject({
      verification_uri: 'https://app.useoctree.com/activate',
      expires_in: 900,
      interval: 5,
    });
    expect(body.verification_uri_complete).toBe(`https://app.useoctree.com/activate?code=${body.user_code}`);
    expect(mem.only()).toMatchObject({ client_name: 'Claude Code', scope: 'compile' });
    const [distinctId, event, props] = holder.capture.mock.calls[0];
    expect(distinctId).toMatch(/^device:/);
    expect(event).toBe('device_code_issued');
    expect(JSON.stringify(props)).not.toContain(body.device_code);
  });

  it('accepts an empty body and rejects bad input', async () => {
    expect((await codePOST(new Request(CODE_URL, { method: 'POST', headers: { 'x-forwarded-for': freshIp() } }))).status).toBe(200);
    expect((await codePOST(json(CODE_URL, { client_name: 'x'.repeat(61) }))).status).toBe(400);
    const scope = await codePOST(json(CODE_URL, { scope: 'admin' }));
    expect(await scope.json()).toMatchObject({ error: 'invalid_scope' });
  });

  it('limits each IP to 10 requests per 10 minutes', async () => {
    const ip = freshIp();
    for (let i = 0; i < 10; i++) expect((await codePOST(json(CODE_URL, {}, ip))).status).toBe(200);
    const limited = await codePOST(json(CODE_URL, {}, ip));
    expect(limited.status).toBe(429);
    expect(limited.headers.get('retry-after')).toBeTruthy();
  });
});

describe('POST /api/v1/device/token', () => {
  beforeEach(() => {
    mem = createMemoryDeviceStore();
    holder.store = mem.store;
    holder.capture.mockClear();
    process.env.DEVICE_FLOW_SECRET = 'route-secret';
  });
  afterEach(() => {
    delete process.env.DEVICE_FLOW_SECRET;
  });

  async function start() {
    return (await (await codePOST(json(CODE_URL, { client_name: 'cli' }))).json()) as {
      device_code: string;
      user_code: string;
    };
  }

  it('speaks RFC 8628 form encoding: pending, then the key once, then expired_token', async () => {
    vi.useFakeTimers({ now: Date.parse('2026-11-25T12:00:00Z'), toFake: ['Date'] });
    try {
      const { device_code, user_code } = await start();
      const pending = await tokenPOST(form(TOKEN_URL, { grant_type: GRANT, device_code }));
      expect(pending.status).toBe(400);
      expect(await pending.json()).toMatchObject({ error: 'authorization_pending', error_description: expect.any(String) });

      const row = mem.only();
      await approveDeviceAuthorization(mem.store, {
        requestId: row.id,
        userCode: user_code,
        userId: 'u1',
        now: Date.now(),
        secret: 'route-secret',
        createKey: async () => ({
          ok: true,
          key: 'oct_live_' + 'z'.repeat(32),
          summary: { id: 'k1', name: 'cli (device)', key_prefix: 'oct_live_zzz', created_at: '', last_used_at: null },
        }),
      });

      vi.setSystemTime(Date.now() + 5_000);
      const ok = await tokenPOST(json(TOKEN_URL, { device_code }));
      expect(ok.status).toBe(200);
      expect(await ok.json()).toEqual({
        api_key: 'oct_live_' + 'z'.repeat(32),
        token_type: 'bearer',
        mcp_url: 'https://app.useoctree.com/api/mcp',
        rest_base: 'https://app.useoctree.com/api/v1',
      });
      const issued = holder.capture.mock.calls.find((c) => c[1] === 'device_token_issued');
      expect(issued?.[0]).toBe('u1');
      expect(JSON.stringify(issued)).not.toContain('oct_live_');

      vi.setSystemTime(Date.now() + 5_000);
      const again = await tokenPOST(json(TOKEN_URL, { device_code }));
      expect(await again.json()).toMatchObject({ error: 'expired_token' });
    } finally {
      vi.useRealTimers();
    }
  });

  it('answers slow_down to a fast poller', async () => {
    const { device_code } = await start();
    await tokenPOST(json(TOKEN_URL, { device_code }));
    const fast = await tokenPOST(json(TOKEN_URL, { device_code }));
    expect(await fast.json()).toMatchObject({ error: 'slow_down', interval: 10 });
  });

  it('rejects bad requests per RFC 6749', async () => {
    expect(await (await tokenPOST(json(TOKEN_URL, {}))).json()).toMatchObject({ error: 'invalid_request' });
    expect(await (await tokenPOST(form(TOKEN_URL, { grant_type: 'password', device_code: 'x' }))).json()).toMatchObject({
      error: 'unsupported_grant_type',
    });
    expect(await (await tokenPOST(json(TOKEN_URL, { device_code: 'nope' }))).json()).toMatchObject({ error: 'invalid_grant' });
    expect(await (await tokenPOST(json(TOKEN_URL, { device_code: 'A'.repeat(43) }))).json()).toMatchObject({
      error: 'invalid_grant',
    });
  });
});

describe('401 onboarding hints', () => {
  it('tells a credential-less agent how to start device authorization, keeping WWW-Authenticate', async () => {
    const result = await authenticateApiRequest(new Request('https://app.useoctree.com/api/mcp', { method: 'POST' }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.response.status).toBe(401);
    expect(result.response.headers.get('www-authenticate')).toMatch(
      /^Bearer realm="octree", resource_metadata="https:\/\/app\.useoctree\.com\/\.well-known\/oauth-protected-resource"/
    );
    const body = await result.response.json();
    expect(body).toMatchObject({
      error: 'unauthorized',
      device_authorization_endpoint: 'https://app.useoctree.com/api/v1/device/code',
      token_endpoint: 'https://app.useoctree.com/api/v1/device/token',
      docs: 'https://www.useoctree.com/developers',
    });
    expect(body.message).toMatch(/^No credentials\. Start device authorization: POST https:\/\/app\.useoctree\.com\/api\/v1\/device\/code/);
  });

  it('adds the hints to a refused key too', async () => {
    const result = await authenticateApiRequest(
      new Request('https://app.useoctree.com/api/v1/me', { headers: { Authorization: 'Bearer oct_live_short', 'x-forwarded-for': freshIp() } })
    );
    if (result.ok) throw new Error('expected 401');
    expect(result.response.status).toBe(401);
    expect(await result.response.json()).toMatchObject({ device_authorization_endpoint: expect.stringContaining('/api/v1/device/code') });
    expect(result.response.headers.get('www-authenticate')).toContain('error="invalid_token"');
  });
});
