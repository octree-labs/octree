// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createMemoryDeviceStore } from '@/tests/helpers/device-memory-store';

/** /activate: the page and its approve/deny action (actions/device-activate.ts). */

const mocks = vi.hoisted(() => ({
  store: null as any,
  getUser: vi.fn(),
  createKey: vi.fn(),
  capture: vi.fn(),
  revalidate: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
}));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidate }));
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { getUser: mocks.getUser } }),
}));
vi.mock('@/lib/device/store', () => ({ createDeviceStore: () => mocks.store }));
vi.mock('@/lib/api/create-key', () => ({ createApiKeyForUser: mocks.createKey }));
vi.mock('@/lib/posthog-server', () => ({ captureServerEventAfterResponse: mocks.capture }));
vi.mock('@/components/icons/octree-logo', () => ({ OctreeLogo: () => null, OctreeWordmark: () => null }));

import { decideDeviceAuthorization } from '@/actions/device-activate';
import ActivatePage from '@/app/activate/page';
import { issueDeviceAuthorization } from '@/lib/device/flow';

const USER = { id: '6f1c2b0e-0f0a-4c55-9a0e-2b8f2f4d1a11', email: 'a@example.com' };
const KEY = 'oct_live_' + 'q'.repeat(32);

let mem: ReturnType<typeof createMemoryDeviceStore>;
let userCode: string;

function form(fields: Record<string, string>) {
  const data = new FormData();
  for (const [k, v] of Object.entries(fields)) data.set(k, v);
  return data;
}

async function redirectOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    const message = (error as Error).message;
    if (message.startsWith('REDIRECT:')) return message.slice('REDIRECT:'.length);
    throw error;
  }
  throw new Error('expected a redirect');
}

function decide(decision: string, code = userCode) {
  return redirectOf(decideDeviceAuthorization(form({ request_id: mem.only().id, user_code: code, decision })));
}

async function page(params: Record<string, string>) {
  return renderToStaticMarkup(await ActivatePage({ searchParams: Promise.resolve(params) }));
}

let userCounter = 0;

beforeEach(async () => {
  vi.clearAllMocks();
  mem = createMemoryDeviceStore();
  mocks.store = mem.store;
  // A fresh user per test: the per-user attempt limiter is process-wide.
  userCounter += 1;
  mocks.getUser.mockResolvedValue({ data: { user: { ...USER, id: USER.id.slice(0, -2) + String(userCounter).padStart(2, '0') } } });
  mocks.createKey.mockResolvedValue({
    ok: true,
    key: KEY,
    summary: { id: 'a1b2c3d4-0000-4000-8000-000000000001', name: 'Claude Code (device)', key_prefix: KEY.slice(0, 12), created_at: '', last_used_at: null },
  });
  process.env.DEVICE_FLOW_SECRET = 'activate-secret';
  const issued = await issueDeviceAuthorization(mem.store, {
    clientName: 'Claude Code',
    scope: 'compile',
    ip: null,
    origin: 'https://app.useoctree.com',
    now: Date.now(),
  });
  if (!issued.ok) throw new Error('issue failed');
  userCode = issued.body.user_code;
});

afterEach(() => {
  delete process.env.DEVICE_FLOW_SECRET;
});

describe('decideDeviceAuthorization', () => {
  it('approve creates a "<client> (device)" key and stores it encrypted', async () => {
    expect(await decide('approve')).toBe('/activate?done=approved');
    expect(mocks.createKey).toHaveBeenCalledWith(expect.anything(), expect.any(String), 'Claude Code (device)', 'device');
    const row = mem.only();
    expect(row).toMatchObject({ status: 'approved', api_key_id: 'a1b2c3d4-0000-4000-8000-000000000001' });
    expect(row.key_ciphertext).toBeTruthy();
    expect(row.key_ciphertext).not.toContain(KEY);
    const [, event, props] = mocks.capture.mock.calls[0];
    expect(event).toBe('device_authorization_approved');
    expect(JSON.stringify(props)).not.toContain('oct_live_');
    expect(mocks.revalidate).toHaveBeenCalledWith('/settings/account');
  });

  it('accepts the code in any case and spacing', async () => {
    expect(await decide('approve', userCode.toLowerCase().replace('-', ' '))).toBe('/activate?done=approved');
  });

  it('sends a full account back with key_limit and keeps the request pending', async () => {
    mocks.createKey.mockResolvedValue({ ok: false, reason: 'limit', error: 'cap' });
    expect(await decide('approve')).toBe(`/activate?code=${userCode}&error=key_limit`);
    expect(mem.only()).toMatchObject({ status: 'pending', user_id: null });
    const html = await page({ code: userCode, error: 'key_limit' });
    expect(html).toContain('5 active API keys');
    expect(html).toContain('/settings/account#api-keys');
    expect(html).toMatch(/value="approve"/);
  });

  it('deny records the decision without creating a key', async () => {
    expect(await decide('deny')).toBe('/activate?done=denied');
    expect(mem.only().status).toBe('denied');
    expect(mocks.createKey).not.toHaveBeenCalled();
    expect(mocks.capture.mock.calls[0][1]).toBe('device_authorization_denied');
  });

  it('refuses a code that does not belong to the request', async () => {
    expect(await decide('approve', 'BBBB-CCCC')).toBe('/activate?code=BBBB-CCCC&error=not_found');
    expect(mem.only().status).toBe('pending');
    expect(mocks.createKey).not.toHaveBeenCalled();
  });

  it('sends signed-out users to login', async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null } });
    expect(decodeURIComponent(await decide('approve'))).toBe(`/auth/login?next=/activate?code=${userCode}`);
  });
});

describe('/activate page', () => {
  it('redirects signed-out visitors to login with the code preserved', async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null } });
    const url = await redirectOf(ActivatePage({ searchParams: Promise.resolve({ code: userCode }) }));
    expect(decodeURIComponent(url)).toBe(`/auth/login?next=/activate?code=${userCode}`);
  });

  it('shows the client, the quota, the account and the prefilled code', async () => {
    const html = await page({ code: userCode.toLowerCase() });
    expect(html).toContain('Connect Claude Code to your Octree account?');
    expect(html).toContain('30 compiles a day on Free');
    expect(html).toContain('1,000 on Pro');
    expect(html).toContain('a@example.com');
    expect(html).toContain(`value="${userCode}"`);
    expect(html).toMatch(/value="deny"/);
  });

  it('asks for a code when none (or an unknown one) is given', async () => {
    expect(await page({})).toContain('Enter the code shown by the agent');
    expect(await page({ code: 'BBBB-CCCC' })).toContain('not valid or has expired');
    expect(await page({ code: 'nope' })).toContain('8-letter code');
  });

  it('confirms the outcome', async () => {
    expect(await page({ done: 'approved' })).toContain('Agent connected');
    expect(await page({ done: 'denied' })).toContain('Request denied');
  });
});
