// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import { looksLikeJwt, verifyOAuthAccessToken } from '@/lib/api/oauth';

const ISSUER = 'https://abcd.supabase.co/auth/v1';
const RESOURCE = 'https://app.useoctree.com/api/mcp';
const USER = '6f1c2b0e-0f0a-4c55-9a0e-2b8f2f4d1a11';
const NOW = Date.parse('2026-11-25T12:00:00Z');

function jwt(payload: Record<string, unknown>): string {
  const enc = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${enc({ alg: 'ES256', kid: 'k1', typ: 'JWT' })}.${enc(payload)}.c2lnbmF0dXJl`;
}

const BASE = {
  iss: ISSUER,
  sub: USER,
  aud: 'authenticated',
  role: 'authenticated',
  client_id: 'client-123',
  exp: NOW / 1000 + 3600,
  iat: NOW / 1000,
};

function client(claims: Record<string, unknown> | null, error: unknown = null) {
  return { getClaims: vi.fn(async () => ({ data: claims ? { claims, header: {}, signature: new Uint8Array() } : null, error })) } as never;
}

const verify = (payload: Record<string, unknown>, verified: Record<string, unknown> | null = payload, error: unknown = null) => {
  const c = client(verified, error);
  return { c, result: verifyOAuthAccessToken(jwt(payload), { issuer: ISSUER, resource: RESOURCE, client: c, now: NOW }) };
};

describe('verifyOAuthAccessToken', () => {
  it('accepts a verified OAuth token and returns user, client and expiry', async () => {
    const { c, result } = verify(BASE);
    expect(await result).toEqual({
      ok: true,
      claims: { userId: USER, clientId: 'client-123', expiresAt: (NOW / 1000 + 3600) * 1000, scope: null },
    });
    expect((c as { getClaims: ReturnType<typeof vi.fn> }).getClaims).toHaveBeenCalledTimes(1);
  });

  it('accepts the MCP resource URL as audience (RFC 8707 via an access token hook)', async () => {
    expect((await verify({ ...BASE, aud: [RESOURCE] }).result).ok).toBe(true);
  });

  it('refuses app session tokens (no client_id)', async () => {
    const { client_id, ...session } = BASE;
    expect(await verify(session).result).toMatchObject({ ok: false, reason: 'not_oauth' });
  });

  it('refuses other audiences, issuers, roles and bad signatures', async () => {
    expect(await verify({ ...BASE, aud: 'https://other.example/api' }).result).toMatchObject({ reason: 'wrong_audience' });
    expect(await verify({ ...BASE, role: 'anon' }).result).toMatchObject({ reason: 'invalid' });
    expect(await verify(BASE, null, { message: 'Invalid JWT signature' }).result).toMatchObject({ reason: 'invalid' });
    // The verified claims win over the unverified peek.
    expect(await verify(BASE, { ...BASE, iss: 'https://evil.example/auth/v1' }).result).toMatchObject({ reason: 'wrong_issuer' });
  });

  it('rejects expired and foreign-issuer tokens before any verification call', async () => {
    const expired = verify({ ...BASE, exp: NOW / 1000 - 1 });
    expect(await expired.result).toMatchObject({ ok: false, reason: 'expired' });
    expect((expired.c as { getClaims: ReturnType<typeof vi.fn> }).getClaims).not.toHaveBeenCalled();
    const foreign = verify({ ...BASE, iss: 'https://accounts.example.com' });
    expect(await foreign.result).toMatchObject({ reason: 'wrong_issuer' });
    expect((foreign.c as { getClaims: ReturnType<typeof vi.fn> }).getClaims).not.toHaveBeenCalled();
  });

  it('recognises JWT-shaped tokens only', () => {
    expect(looksLikeJwt(jwt(BASE))).toBe(true);
    expect(looksLikeJwt('oct_live_abcdefghijklmnopqrstuvwxyz012345')).toBe(false);
    expect(looksLikeJwt('a.b')).toBe(false);
  });
});
