import {
  DEVICE_CODE_EXPIRES_IN,
  DEVICE_POLL_INTERVAL,
  type DeviceScope,
  deviceKeyName,
  generateDeviceCode,
  generateUserCode,
  hashDeviceCode,
  verificationUri,
  verificationUriComplete,
} from '@/lib/device/codes';
import { decryptDeviceKey, encryptDeviceKey } from '@/lib/device/crypto';
import { MCP_PATH } from '@/lib/api/origin';
import type { CreateKeyForUserResult } from '@/lib/api/create-key';

/**
 * The device authorization state machine (RFC 8628 style), over a small
 * storage interface so it is unit tested without Supabase
 * (lib/device/store.ts is the real one, on the service-role client).
 *
 *   issue   POST /api/v1/device/code         -> pending
 *   approve /activate (signed in)            pending -> approved (+ API key, encrypted)
 *   deny    /activate                        pending -> denied
 *   poll    POST /api/v1/device/token        approved -> consumed (key returned once)
 *                                            pending/approved past expires_at -> expired
 *
 * Every transition is a conditional update on the current status, so two
 * concurrent approvals or polls cannot both win: only one poll ever receives
 * the key. A key created for a request that expires before the agent
 * collects it is revoked (here on the next poll, or by the hourly cron).
 */

export type DeviceStatus = 'pending' | 'approved' | 'denied' | 'consumed' | 'expired';

export interface DeviceRow {
  id: string;
  device_code_hash: string;
  user_code: string;
  client_name: string | null;
  scope: string;
  status: DeviceStatus;
  user_id: string | null;
  api_key_id: string | null;
  key_ciphertext: string | null;
  created_at: string;
  expires_at: string;
  approved_at: string | null;
  consumed_at: string | null;
  last_polled_at: string | null;
}

export interface NewDeviceRow {
  device_code_hash: string;
  user_code: string;
  client_name: string | null;
  scope: DeviceScope;
  expires_at: string;
  ip: string | null;
}

export interface TransitionGuard {
  /** Only if the request has not expired at this instant. */
  notExpiredAt?: string;
  /** Only while no ciphertext is stored (or only while one is). */
  ciphertext?: 'absent' | 'present';
}

/** Storage for device authorizations. Methods throw on database errors. */
export interface DeviceStore {
  /** `conflict` when the user code is already taken by a live request. */
  insert(row: NewDeviceRow): Promise<{ ok: true; row: DeviceRow } | { ok: false; conflict: boolean }>;
  findByDeviceCodeHash(hash: string): Promise<DeviceRow | null>;
  findById(id: string): Promise<DeviceRow | null>;
  /** The pending request with this user code, if any. */
  findPendingByUserCode(userCode: string): Promise<DeviceRow | null>;
  /** Applies `patch` only while the row is in status `from` (and the guard holds); the updated row or null. */
  transition(id: string, from: DeviceStatus, patch: Partial<DeviceRow>, guard?: TransitionGuard): Promise<DeviceRow | null>;
  touchPolled(id: string, at: string): Promise<void>;
  revokeApiKey(keyId: string, at: string): Promise<void>;
}

// ---------------------------------------------------------------------------
// Issue
// ---------------------------------------------------------------------------

export interface DeviceCodeResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  verification_uri_complete: string;
  expires_in: number;
  interval: number;
}

export type IssueResult = { ok: true; body: DeviceCodeResponse; row: DeviceRow } | { ok: false };

export async function issueDeviceAuthorization(
  store: DeviceStore,
  input: { clientName: string | null; scope: DeviceScope; ip: string | null; origin: string; now: number }
): Promise<IssueResult> {
  // A user code collision needs two live requests to draw the same one of
  // 20^8 codes; retry a couple of times anyway.
  for (let attempt = 0; attempt < 3; attempt++) {
    const deviceCode = generateDeviceCode();
    const userCode = generateUserCode();
    const inserted = await store.insert({
      device_code_hash: hashDeviceCode(deviceCode),
      user_code: userCode,
      client_name: input.clientName,
      scope: input.scope,
      expires_at: new Date(input.now + DEVICE_CODE_EXPIRES_IN * 1000).toISOString(),
      ip: input.ip,
    });
    if (inserted.ok) {
      return {
        ok: true,
        row: inserted.row,
        body: {
          device_code: deviceCode,
          user_code: userCode,
          verification_uri: verificationUri(input.origin),
          verification_uri_complete: verificationUriComplete(input.origin, userCode),
          expires_in: DEVICE_CODE_EXPIRES_IN,
          interval: DEVICE_POLL_INTERVAL,
        },
      };
    }
    if (!inserted.conflict) return { ok: false };
  }
  return { ok: false };
}

// ---------------------------------------------------------------------------
// Poll
// ---------------------------------------------------------------------------

export type DeviceTokenError =
  | 'authorization_pending'
  | 'slow_down'
  | 'access_denied'
  | 'expired_token'
  | 'invalid_grant';

export interface DeviceTokenSuccess {
  api_key: string;
  token_type: 'bearer';
  mcp_url: string;
  rest_base: string;
}

export type PollResult =
  | { kind: 'token'; body: DeviceTokenSuccess; row: DeviceRow }
  | { kind: 'error'; error: DeviceTokenError; description: string; interval?: number };

/**
 * Polls closer together than this are answered `slow_down`. One second
 * below the advertised interval absorbs network jitter of a client that
 * polls exactly every `interval` seconds.
 */
export const MIN_POLL_GAP_MS = (DEVICE_POLL_INTERVAL - 1) * 1000;

function expired(row: DeviceRow, now: number): boolean {
  return Date.parse(row.expires_at) <= now;
}

const EXPIRED: PollResult = {
  kind: 'error',
  error: 'expired_token',
  description: 'The device code has expired or was already used. Start again with POST /api/v1/device/code.',
};

/** Marks a live request expired (and revokes a key nobody collected). */
async function expire(store: DeviceStore, row: DeviceRow, at: string): Promise<void> {
  if (row.status !== 'pending' && row.status !== 'approved') return;
  const done = await store.transition(row.id, row.status, { status: 'expired', key_ciphertext: null });
  if (done && row.status === 'approved' && row.api_key_id) await store.revokeApiKey(row.api_key_id, at);
}

export async function pollDeviceToken(
  store: DeviceStore,
  deviceCode: string,
  input: { now: number; secret: string | null; origin: string }
): Promise<PollResult> {
  const row = await store.findByDeviceCodeHash(hashDeviceCode(deviceCode));
  if (!row) return { kind: 'error', error: 'invalid_grant', description: 'Unknown device_code.' };

  const nowIso = new Date(input.now).toISOString();
  if (row.status === 'denied') {
    return { kind: 'error', error: 'access_denied', description: 'The user denied the request.' };
  }
  if (row.status === 'consumed' || row.status === 'expired') return EXPIRED;
  if (expired(row, input.now)) {
    await expire(store, row, nowIso);
    return EXPIRED;
  }

  const last = row.last_polled_at ? Date.parse(row.last_polled_at) : NaN;
  await store.touchPolled(row.id, nowIso);
  if (Number.isFinite(last) && input.now - last < MIN_POLL_GAP_MS) {
    return {
      kind: 'error',
      error: 'slow_down',
      description: `Polling too fast. Wait at least ${DEVICE_POLL_INTERVAL + 5} seconds between requests.`,
      interval: DEVICE_POLL_INTERVAL + 5,
    };
  }

  if (row.status === 'pending' || !row.key_ciphertext) {
    return {
      kind: 'error',
      error: 'authorization_pending',
      description: 'Waiting for the user to approve at verification_uri.',
    };
  }

  // Approved with a key waiting. Decrypt first: a key that cannot be
  // delivered is revoked rather than left behind.
  const key = input.secret ? decryptDeviceKey(row.key_ciphertext, row.id, input.secret) : null;
  if (!key) {
    console.error('[device-flow] could not decrypt an approved key; expiring the request');
    await expire(store, row, nowIso);
    return EXPIRED;
  }
  const consumed = await store.transition(
    row.id,
    'approved',
    { status: 'consumed', key_ciphertext: null, consumed_at: nowIso },
    { ciphertext: 'present' }
  );
  // Another poll got there first: the key has already been handed out.
  if (!consumed) return EXPIRED;

  const origin = input.origin.replace(/\/+$/, '');
  return {
    kind: 'token',
    row: consumed,
    body: { api_key: key, token_type: 'bearer', mcp_url: `${origin}${MCP_PATH}`, rest_base: `${origin}/api/v1` },
  };
}

// ---------------------------------------------------------------------------
// Approve / deny (/activate)
// ---------------------------------------------------------------------------

/** The pending, unexpired request for a user code, or null. */
export async function findActivatableRequest(store: DeviceStore, userCode: string, now: number): Promise<DeviceRow | null> {
  const row = await store.findPendingByUserCode(userCode);
  if (!row || row.status !== 'pending' || expired(row, now)) return null;
  return row;
}

export type DecisionResult =
  | { ok: true; row: DeviceRow }
  | { ok: false; reason: 'not_found' | 'limit' | 'failed' };

async function decidable(store: DeviceStore, requestId: string, userCode: string, now: number): Promise<DeviceRow | null> {
  const row = await store.findById(requestId);
  if (!row || row.user_code !== userCode || row.status !== 'pending' || expired(row, now)) return null;
  return row;
}

export async function approveDeviceAuthorization(
  store: DeviceStore,
  input: {
    requestId: string;
    userCode: string;
    userId: string;
    now: number;
    secret: string | null;
    createKey: (name: string) => Promise<CreateKeyForUserResult>;
  }
): Promise<DecisionResult> {
  if (!input.secret) {
    console.error('[device-flow] no DEVICE_FLOW_SECRET or SUPABASE_SERVICE_ROLE_KEY; cannot approve');
    return { ok: false, reason: 'failed' };
  }
  const row = await decidable(store, input.requestId, input.userCode, input.now);
  if (!row) return { ok: false, reason: 'not_found' };

  const nowIso = new Date(input.now).toISOString();
  // Claim the request first, so a second approval (double submit, another
  // tab) cannot create a second key.
  const claimed = await store.transition(
    row.id,
    'pending',
    { status: 'approved', user_id: input.userId, approved_at: nowIso },
    { notExpiredAt: nowIso }
  );
  if (!claimed) return { ok: false, reason: 'not_found' };

  const release = () =>
    store.transition(row.id, 'approved', { status: 'pending', user_id: null, approved_at: null }, { ciphertext: 'absent' });

  const created = await input.createKey(deviceKeyName(row.client_name));
  if (!created.ok) {
    // Back to pending: after revoking a key in Settings the user can approve again.
    await release();
    return { ok: false, reason: created.reason === 'limit' ? 'limit' : 'failed' };
  }

  const keyId = created.summary.id || null;
  const stored = await store.transition(
    row.id,
    'approved',
    { key_ciphertext: encryptDeviceKey(created.key, row.id, input.secret), api_key_id: keyId },
    { ciphertext: 'absent' }
  );
  if (!stored) {
    // Expired (or otherwise moved on) between the claim and now.
    if (keyId) await store.revokeApiKey(keyId, nowIso);
    return { ok: false, reason: 'failed' };
  }
  return { ok: true, row: stored };
}

export async function denyDeviceAuthorization(
  store: DeviceStore,
  input: { requestId: string; userCode: string; userId: string; now: number }
): Promise<DecisionResult> {
  const row = await decidable(store, input.requestId, input.userCode, input.now);
  if (!row) return { ok: false, reason: 'not_found' };
  const denied = await store.transition(row.id, 'pending', { status: 'denied', user_id: input.userId });
  return denied ? { ok: true, row: denied } : { ok: false, reason: 'not_found' };
}
