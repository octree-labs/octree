// @vitest-environment node
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  approveDeviceAuthorization,
  denyDeviceAuthorization,
  findActivatableRequest,
  issueDeviceAuthorization,
  pollDeviceToken,
} from '@/lib/device/flow';
import { decryptDeviceKey } from '@/lib/device/crypto';
import type { CreateKeyForUserResult } from '@/lib/api/create-key';
import { createMemoryDeviceStore } from '@/tests/helpers/device-memory-store';

const ORIGIN = 'https://app.useoctree.com';
const SECRET = 'device-secret';
const USER = '6f1c2b0e-0f0a-4c55-9a0e-2b8f2f4d1a11';
const KEY = 'oct_live_' + 'k'.repeat(32);
const KEY_ID = '9d0c1b2a-3e4f-4a5b-8c6d-7e8f9a0b1c2d';
const T0 = Date.parse('2026-11-25T12:00:00Z');

function okKey(): Promise<CreateKeyForUserResult> {
  return Promise.resolve({
    ok: true,
    key: KEY,
    summary: { id: KEY_ID, name: 'x', key_prefix: KEY.slice(0, 12), created_at: '', last_used_at: null },
  });
}

let mem: ReturnType<typeof createMemoryDeviceStore>;

async function issue(clientName: string | null = 'Claude Code') {
  const result = await issueDeviceAuthorization(mem.store, { clientName, scope: 'compile', ip: '192.0.2.1', origin: ORIGIN, now: T0 });
  if (!result.ok) throw new Error('issue failed');
  return result.body;
}

function poll(deviceCode: string, now: number, secret: string | null = SECRET) {
  return pollDeviceToken(mem.store, deviceCode, { now, secret, origin: ORIGIN });
}

async function approve(userCode: string, now: number, createKey = okKey) {
  const row = mem.only();
  return approveDeviceAuthorization(mem.store, { requestId: row.id, userCode, userId: USER, now, secret: SECRET, createKey });
}

describe('device authorization flow', () => {
  beforeEach(() => {
    mem = createMemoryDeviceStore();
  });

  it('issues an RFC 8628 response and stores only the hash', async () => {
    const body = await issue();
    expect(body).toMatchObject({
      verification_uri: `${ORIGIN}/activate`,
      verification_uri_complete: `${ORIGIN}/activate?code=${body.user_code}`,
      expires_in: 900,
      interval: 5,
    });
    const row = mem.only();
    expect(row.device_code_hash).not.toBe(body.device_code);
    expect(row.device_code_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(row.expires_at).toBe(new Date(T0 + 900_000).toISOString());
  });

  it('retries a user code collision', async () => {
    const insert = vi.spyOn(mem.store, 'insert').mockResolvedValueOnce({ ok: false, conflict: true });
    await issue();
    expect(insert).toHaveBeenCalledTimes(2);
  });

  it('pending -> slow_down -> approved -> key once -> expired_token', async () => {
    const { device_code, user_code } = await issue();

    expect(await poll(device_code, T0 + 5_000)).toMatchObject({ kind: 'error', error: 'authorization_pending' });
    expect(await poll(device_code, T0 + 6_000)).toMatchObject({ kind: 'error', error: 'slow_down', interval: 10 });
    expect(await poll(device_code, T0 + 16_000)).toMatchObject({ kind: 'error', error: 'authorization_pending' });

    expect(await approve(user_code, T0 + 20_000)).toMatchObject({ ok: true });
    const approved = mem.only();
    expect(approved).toMatchObject({ status: 'approved', user_id: USER, api_key_id: KEY_ID });
    expect(approved.key_ciphertext).not.toContain(KEY);
    expect(decryptDeviceKey(approved.key_ciphertext!, approved.id, SECRET)).toBe(KEY);

    const token = await poll(device_code, T0 + 25_000);
    expect(token).toMatchObject({
      kind: 'token',
      body: { api_key: KEY, token_type: 'bearer', mcp_url: `${ORIGIN}/api/mcp`, rest_base: `${ORIGIN}/api/v1` },
    });
    expect(mem.only()).toMatchObject({ status: 'consumed', key_ciphertext: null });

    expect(await poll(device_code, T0 + 30_000)).toMatchObject({ kind: 'error', error: 'expired_token' });
  });

  it('hands the key to only one of two concurrent polls', async () => {
    const { device_code, user_code } = await issue();
    await approve(user_code, T0 + 1_000);
    const [a, b] = await Promise.all([poll(device_code, T0 + 10_000), poll(device_code, T0 + 10_000)]);
    const tokens = [a, b].filter((r) => r.kind === 'token');
    expect(tokens).toHaveLength(1);
  });

  it('answers access_denied after a deny', async () => {
    const { device_code, user_code } = await issue();
    const row = mem.only();
    expect(await denyDeviceAuthorization(mem.store, { requestId: row.id, userCode: user_code, userId: USER, now: T0 + 1_000 })).toMatchObject({
      ok: true,
    });
    expect(await poll(device_code, T0 + 5_000)).toMatchObject({ kind: 'error', error: 'access_denied' });
    expect(await approve(user_code, T0 + 6_000)).toEqual({ ok: false, reason: 'not_found' });
  });

  it('expires after 15 minutes, revoking a key nobody collected', async () => {
    const { device_code, user_code } = await issue();
    await approve(user_code, T0 + 60_000);
    expect(await poll(device_code, T0 + 900_000)).toMatchObject({ kind: 'error', error: 'expired_token' });
    expect(mem.only()).toMatchObject({ status: 'expired', key_ciphertext: null });
    expect(mem.revoked).toEqual([KEY_ID]);
  });

  it('cannot be approved once expired', async () => {
    const { user_code } = await issue();
    expect(await findActivatableRequest(mem.store, user_code, T0 + 900_001)).toBeNull();
    expect(await approve(user_code, T0 + 900_001)).toEqual({ ok: false, reason: 'not_found' });
  });

  it('rejects unknown device codes', async () => {
    expect(await poll('A'.repeat(43), T0)).toMatchObject({ kind: 'error', error: 'invalid_grant' });
  });

  it('expires (and revokes) when the stored key cannot be decrypted', async () => {
    const { device_code, user_code } = await issue();
    await approve(user_code, T0 + 1_000);
    expect(await poll(device_code, T0 + 10_000, 'rotated-secret')).toMatchObject({ error: 'expired_token' });
    expect(mem.revoked).toEqual([KEY_ID]);
  });

  it('puts the request back to pending when the key cap is reached', async () => {
    const { device_code, user_code } = await issue();
    const full = () => Promise.resolve<CreateKeyForUserResult>({ ok: false, reason: 'limit', error: 'cap' });
    expect(await approve(user_code, T0 + 1_000, full)).toEqual({ ok: false, reason: 'limit' });
    expect(mem.only()).toMatchObject({ status: 'pending', user_id: null, key_ciphertext: null });
    expect(await poll(device_code, T0 + 5_000)).toMatchObject({ error: 'authorization_pending' });
    // After revoking a key in Settings, approving again works.
    expect(await approve(user_code, T0 + 60_000)).toMatchObject({ ok: true });
  });

  it('creates only one key on a double approval', async () => {
    const { user_code } = await issue();
    const createKey = vi.fn(okKey);
    const [a, b] = await Promise.all([approve(user_code, T0 + 1_000, createKey), approve(user_code, T0 + 1_000, createKey)]);
    expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1);
    expect(createKey).toHaveBeenCalledTimes(1);
  });

  it('refuses a code that does not match the request', async () => {
    await issue();
    expect(await approve('BBBB-BBBB', T0 + 1_000)).toEqual({ ok: false, reason: 'not_found' });
  });

  it('refuses to approve without an encryption secret', async () => {
    const { user_code } = await issue();
    const row = mem.only();
    const createKey = vi.fn(okKey);
    expect(
      await approveDeviceAuthorization(mem.store, { requestId: row.id, userCode: user_code, userId: USER, now: T0, secret: null, createKey })
    ).toEqual({ ok: false, reason: 'failed' });
    expect(createKey).not.toHaveBeenCalled();
  });
});
