import { describe, it, expect } from 'vitest';
import {
  ALLOWED_JWKS_ALGORITHMS,
  ALLOWED_SECRET_ALGORITHMS,
  getAgentUserClaims,
} from '@/services/agent/lib/auth-claims';

describe('agent service JWT claim checks', () => {
  it('accepts a signed-in user token', () => {
    expect(getAgentUserClaims({ role: 'authenticated', sub: 'user-1', aud: 'authenticated' })).toEqual({
      role: 'authenticated',
      sub: 'user-1',
    });
  });

  it.each([
    { role: 'anon' },
    { role: 'anon', sub: 'x' },
    { role: 'service_role' },
    { role: 'service_role', sub: 'x' },
    { role: 'authenticated' },
    { role: 'authenticated', sub: '' },
    { role: 'authenticated', sub: '   ' },
    { role: 'authenticated', sub: 42 },
    { sub: 'user-1' },
  ])('rejects %j', (payload) => {
    expect(getAgentUserClaims(payload)).toBeNull();
  });

  it('rejects non-object payloads', () => {
    expect(getAgentUserClaims(null)).toBeNull();
    expect(getAgentUserClaims('authenticated')).toBeNull();
    expect(getAgentUserClaims([])).toBeNull();
  });

  it('keeps symmetric and asymmetric algorithms apart', () => {
    expect([...ALLOWED_SECRET_ALGORITHMS]).toEqual(['HS256']);
    expect([...ALLOWED_JWKS_ALGORITHMS]).toEqual(['ES256', 'RS256']);
  });
});
