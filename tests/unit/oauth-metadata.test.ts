// @vitest-environment node
import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  bearerChallenge,
  mcpResourceUrl,
  oauthIssuer,
  protectedResourceMetadata,
} from '@/lib/api/oauth-metadata';
import { GET as rootMetadata, OPTIONS as rootOptions } from '@/app/.well-known/oauth-protected-resource/route';
import { GET as mcpMetadata } from '@/app/.well-known/oauth-protected-resource/api/mcp/route';
import { config as middlewareConfig } from '@/middleware';

const ORIGIN = 'https://app.useoctree.com';
const SUPABASE = 'https://abcd.supabase.co';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('protected resource metadata (RFC 9728)', () => {
  it('names the MCP endpoint as the resource and Supabase Auth as the issuer', () => {
    expect(oauthIssuer(`${SUPABASE}/`)).toBe(`${SUPABASE}/auth/v1`);
    expect(oauthIssuer('')).toBeNull();
    expect(mcpResourceUrl(ORIGIN)).toBe('https://app.useoctree.com/api/mcp');
    expect(protectedResourceMetadata(ORIGIN, `${SUPABASE}/auth/v1`)).toMatchObject({
      resource: 'https://app.useoctree.com/api/mcp',
      authorization_servers: [`${SUPABASE}/auth/v1`],
      scopes_supported: ['email'],
      bearer_methods_supported: ['header'],
    });
  });

  it('is served at the root and at the path-suffixed well-known URI, CORS-open', async () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', SUPABASE);
    for (const [handler, path] of [
      [rootMetadata, '/.well-known/oauth-protected-resource'],
      [mcpMetadata, '/.well-known/oauth-protected-resource/api/mcp'],
    ] as const) {
      const response = await handler(new Request(`${ORIGIN}${path}`));
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toMatch(/application\/json/);
      expect(response.headers.get('access-control-allow-origin')).toBe('*');
      const body = await response.json();
      expect(body.resource).toBe('https://app.useoctree.com/api/mcp');
      expect(body.authorization_servers).toEqual(['https://abcd.supabase.co/auth/v1']);
    }
    expect((await rootOptions()).status).toBe(204);
  });

  it('is 503 rather than an empty authorization_servers list when unconfigured', async () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', '');
    const response = await rootMetadata(new Request(`${ORIGIN}/.well-known/oauth-protected-resource`));
    expect(response.status).toBe(503);
  });

  it('is not run through the session middleware (no login redirect)', () => {
    const matcher = new RegExp(`^${middlewareConfig.matcher[0]}$`);
    expect(matcher.test('/.well-known/oauth-protected-resource')).toBe(false);
    expect(matcher.test('/.well-known/oauth-protected-resource/api/mcp')).toBe(false);
    expect(matcher.test('/oauth/consent')).toBe(true);
    expect(matcher.test('/projects/x')).toBe(true);
  });
});

describe('bearerChallenge', () => {
  it('points at the metadata and keeps the realm', () => {
    expect(bearerChallenge(ORIGIN)).toBe(
      'Bearer realm="octree", resource_metadata="https://app.useoctree.com/.well-known/oauth-protected-resource", scope="email"'
    );
    expect(bearerChallenge(ORIGIN, { error: 'invalid_token' })).toMatch(/, error="invalid_token"$/);
  });
});
