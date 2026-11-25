// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  USER_CODE_ALPHABET,
  activatePath,
  credentialHints,
  deviceKeyName,
  generateDeviceCode,
  generateUserCode,
  hashDeviceCode,
  isDeviceCodeFormat,
  loginPathForActivate,
  normalizeUserCode,
  noCredentialsMessage,
  parseClientName,
  verificationUriComplete,
} from '@/lib/device/codes';
import { decryptDeviceKey, deviceFlowSecret, encryptDeviceKey } from '@/lib/device/crypto';
import { normalizeApiKeyName } from '@/lib/api/keys';

describe('user codes', () => {
  it('uses an unambiguous alphabet: no vowels, no 0/O/1/I', () => {
    expect(USER_CODE_ALPHABET).toHaveLength(20);
    expect(USER_CODE_ALPHABET).not.toMatch(/[AEIOUY01]/);
    expect(new Set(USER_CODE_ALPHABET).size).toBe(USER_CODE_ALPHABET.length);
  });

  it('generates XXXX-XXXX codes from the alphabet', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 500; i++) {
      const code = generateUserCode();
      expect(code).toMatch(/^[BCDFGHJKLMNPQRSTVWXZ]{4}-[BCDFGHJKLMNPQRSTVWXZ]{4}$/);
      seen.add(code);
    }
    expect(seen.size).toBeGreaterThan(495);
  });

  it('uses the random source uniformly over the alphabet', () => {
    let i = 0;
    expect(generateUserCode((max) => i++ % max)).toBe('BCDF-GHJK');
  });

  it('normalizes what users type', () => {
    expect(normalizeUserCode('wdjb-mjht')).toBe('WDJB-MJHT');
    expect(normalizeUserCode(' WDJB MJHT ')).toBe('WDJB-MJHT');
    expect(normalizeUserCode('WDJBMJHT')).toBe('WDJB-MJHT');
    expect(normalizeUserCode('WDJB-MJH')).toBeNull();
    expect(normalizeUserCode('WDJB-MJHA')).toBeNull(); // vowel
    expect(normalizeUserCode('WDJB-MJH0')).toBeNull();
    expect(normalizeUserCode(42)).toBeNull();
  });
});

describe('device codes', () => {
  it('are 256-bit base64url and stored only as sha256', () => {
    const code = generateDeviceCode();
    expect(isDeviceCodeFormat(code)).toBe(true);
    expect(Buffer.from(code, 'base64url')).toHaveLength(32);
    expect(hashDeviceCode(code)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashDeviceCode(code)).not.toContain(code);
    expect(isDeviceCodeFormat('short')).toBe(false);
  });
});

describe('client names and key names', () => {
  it('accepts a missing or short single-line name', () => {
    expect(parseClientName(undefined)).toEqual({ ok: true, name: null });
    expect(parseClientName('   ')).toEqual({ ok: true, name: null });
    expect(parseClientName('  My\nagent‮ ')).toEqual({ ok: true, name: 'My agent' });
    expect(parseClientName('x'.repeat(61))).toEqual({ ok: false });
    expect(parseClientName(5)).toEqual({ ok: false });
  });

  it('builds a valid API key name', () => {
    expect(deviceKeyName('Claude Code')).toBe('Claude Code (device)');
    expect(deviceKeyName(null)).toBe('Agent (device)');
    const long = deviceKeyName('y'.repeat(60));
    expect(normalizeApiKeyName(long)).toBe(long);
  });

  it('builds activate and login paths', () => {
    expect(verificationUriComplete('https://app.useoctree.com', 'WDJB-MJHT')).toBe(
      'https://app.useoctree.com/activate?code=WDJB-MJHT'
    );
    expect(activatePath({ code: 'WDJB-MJHT', error: 'key_limit' })).toBe('/activate?code=WDJB-MJHT&error=key_limit');
    expect(decodeURIComponent(loginPathForActivate('WDJB-MJHT'))).toBe('/auth/login?next=/activate?code=WDJB-MJHT');
  });

  it('describes the device flow for 401 bodies', () => {
    expect(credentialHints('https://app.useoctree.com')).toEqual({
      device_authorization_endpoint: 'https://app.useoctree.com/api/v1/device/code',
      token_endpoint: 'https://app.useoctree.com/api/v1/device/token',
      docs: 'https://www.useoctree.com/developers',
    });
    expect(noCredentialsMessage('https://app.useoctree.com')).toMatch(
      /^No credentials\. Start device authorization: POST https:\/\/app\.useoctree\.com\/api\/v1\/device\/code, then ask the user to open verification_uri_complete; poll \/api\/v1\/device\/token\./
    );
  });
});

describe('key encryption', () => {
  const secret = 'test-device-flow-secret';
  const key = 'oct_live_' + 'a'.repeat(32);
  const row = '0b8b6f0e-1c2d-4e5f-8a9b-0c1d2e3f4a5b';

  it('round-trips and never contains the plaintext', () => {
    const sealed = encryptDeviceKey(key, row, secret);
    expect(sealed).toMatch(/^v1\./);
    expect(sealed).not.toContain('aaaa');
    expect(encryptDeviceKey(key, row, secret)).not.toBe(sealed); // fresh IV
    expect(decryptDeviceKey(sealed, row, secret)).toBe(key);
  });

  it('refuses another row, another secret, or tampering', () => {
    const sealed = encryptDeviceKey(key, row, secret);
    expect(decryptDeviceKey(sealed, '11111111-1c2d-4e5f-8a9b-0c1d2e3f4a5b', secret)).toBeNull();
    expect(decryptDeviceKey(sealed, row, 'other')).toBeNull();
    const parts = sealed.split('.');
    const body = Buffer.from(parts[3], 'base64url');
    body[0] ^= 1;
    expect(decryptDeviceKey([parts[0], parts[1], parts[2], body.toString('base64url')].join('.'), row, secret)).toBeNull();
    expect(decryptDeviceKey([parts[0], parts[1], parts[2].slice(0, 4), parts[3]].join('.'), row, secret)).toBeNull();
    expect(decryptDeviceKey('garbage', row, secret)).toBeNull();
  });

  it('prefers DEVICE_FLOW_SECRET and falls back to the service role key', () => {
    expect(deviceFlowSecret({ DEVICE_FLOW_SECRET: 'a', SUPABASE_SERVICE_ROLE_KEY: 'b' })).toBe('a');
    expect(deviceFlowSecret({ SUPABASE_SERVICE_ROLE_KEY: 'b' })).toBe('b');
    expect(deviceFlowSecret({})).toBeNull();
  });
});

describe('device_authorizations migration', () => {
  const sql = readFileSync(
    join(__dirname, '../../supabase/migrations/20261128000000_device_authorizations.sql'),
    'utf8'
  ).toLowerCase();

  it('is idempotent and service-role only', () => {
    expect(sql).toContain('create table if not exists public.device_authorizations');
    expect(sql).toContain('enable row level security');
    expect(sql).not.toMatch(/create policy/);
    expect(sql).toContain('revoke all on public.device_authorizations from anon, authenticated');
    expect(sql).toMatch(/create unique index if not exists device_authorizations_device_code_hash_key/);
    expect(sql).toMatch(/create unique index if not exists device_authorizations_live_user_code_key[\s\S]*where status in \('pending', 'approved'\)/);
  });
});
