// @vitest-environment node
import { describe, it, expect, beforeEach, vi } from 'vitest';

/** lib/oauth: discovery documents, redirect URI rules, clients (DCR + CIMD), PKCE, authorize validation. */

import * as prmRoute from '@/app/.well-known/oauth-protected-resource/route';
import * as prmMcpRoute from '@/app/.well-known/oauth-protected-resource/api/mcp/route';
import * as asRoute from '@/app/.well-known/oauth-authorization-server/route';
import {
  bearerChallenge,
  grantedScope,
  isAcceptedResource,
  authorizationServerMetadata,
} from '@/lib/oauth/metadata';
import {
  checkRedirectUri,
  checkRedirectUris,
  findMatchingRedirectUri,
  redirectDisplay,
  redirectUriMatches,
} from '@/lib/oauth/redirect-uri';
import {
  isCimdClientId,
  oauthKeyName,
  parseCimdDocument,
  parseRegistrationRequest,
  sanitizeClientName,
  type ClientInfo,
} from '@/lib/oauth/clients';
import { clearCimdCache, isPublicAddress, resolveCimdClient } from '@/lib/oauth/cimd';
import { isCodeVerifier, s256Challenge, verifyPkce } from '@/lib/oauth/tokens';
import { buildClientRedirect, pickAuthorizeParams, validateAuthorizeRequest } from '@/lib/oauth/authorize';
import { createConsentToken, isSameOriginPost, originFromHeaders, verifyConsentToken } from '@/lib/oauth/consent';

const ORIGIN = 'https://app.useoctree.com';

describe('discovery documents', () => {
  it('serves RFC 9728 protected resource metadata at both well-known paths', async () => {
    for (const route of [prmRoute, prmMcpRoute]) {
      const response = route.GET(new Request(`${ORIGIN}/.well-known/oauth-protected-resource`));
      expect(response.status).toBe(200);
      expect(response.headers.get('access-control-allow-origin')).toBe('*');
      expect(await response.json()).toEqual({
        resource: `${ORIGIN}/api/mcp`,
        authorization_servers: [ORIGIN],
        scopes_supported: ['compile'],
        bearer_methods_supported: ['header'],
        resource_name: expect.any(String),
        resource_documentation: expect.any(String),
      });
    }
  });

  it('serves RFC 8414 authorization server metadata that Claude accepts for CIMD', async () => {
    const response = asRoute.GET(new Request(`${ORIGIN}/.well-known/oauth-authorization-server`));
    const doc = await response.json();
    expect(doc).toMatchObject({
      issuer: ORIGIN,
      authorization_endpoint: `${ORIGIN}/oauth/authorize`,
      token_endpoint: `${ORIGIN}/oauth/token`,
      registration_endpoint: `${ORIGIN}/oauth/register`,
      revocation_endpoint: `${ORIGIN}/oauth/revoke`,
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['none'],
      scopes_supported: ['compile', 'offline_access'],
      client_id_metadata_document_supported: true,
    });
  });

  it('describes the deployment it is served from', () => {
    expect(authorizationServerMetadata('https://preview.vercel.app').token_endpoint).toBe('https://preview.vercel.app/oauth/token');
  });

  it('builds the WWW-Authenticate challenge with resource_metadata', () => {
    expect(bearerChallenge(ORIGIN)).toBe(
      `Bearer realm="octree", resource_metadata="${ORIGIN}/.well-known/oauth-protected-resource", scope="compile"`
    );
    expect(bearerChallenge(ORIGIN, { error: 'invalid_token', description: 'The access token "x" expired' })).toContain(
      'error="invalid_token", error_description="The access token x expired"'
    );
  });

  it('accepts only this server as the resource', () => {
    expect(isAcceptedResource(`${ORIGIN}/api/mcp`, ORIGIN)).toBe(true);
    expect(isAcceptedResource(`${ORIGIN}/api/mcp/`, ORIGIN)).toBe(true);
    expect(isAcceptedResource('HTTPS://APP.USEOCTREE.COM/api/mcp', ORIGIN)).toBe(true);
    expect(isAcceptedResource(ORIGIN, ORIGIN)).toBe(true);
    expect(isAcceptedResource('https://evil.example/api/mcp', ORIGIN)).toBe(false);
    expect(isAcceptedResource(`${ORIGIN}/api/mcp#x`, ORIGIN)).toBe(false);
    expect(isAcceptedResource(`${ORIGIN}/rest/v1`, ORIGIN)).toBe(false);
  });

  it('grants compile, plus offline_access when asked, ignoring unknown scopes', () => {
    expect(grantedScope(undefined)).toBe('compile');
    expect(grantedScope('openid profile')).toBe('compile');
    expect(grantedScope('compile offline_access')).toBe('compile offline_access');
  });
});

describe('redirect URIs', () => {
  it.each([
    'https://claude.ai/api/mcp/auth_callback',
    'http://localhost/callback',
    'http://127.0.0.1:33418/callback',
    'http://[::1]:8080/cb',
    'cursor://anysphere.cursor-retrieval/oauth/user-octree/callback',
    'vscode://vscode.github-authentication/did-authenticate',
    'com.example.app:/oauth2redirect',
  ])('accepts %s', (uri) => {
    expect(checkRedirectUri(uri).ok).toBe(true);
  });

  it.each([
    'javascript:alert(1)',
    'data:text/html,hi',
    'file:///etc/passwd',
    'blob:https://x/y',
    'http://example.com/callback',
    'http://192.168.1.10/callback',
    'https://claude.ai/cb#frag',
    'https://user:pw@claude.ai/cb',
    '/relative/callback',
    'https://claude.ai/cb with space',
    'chrome-extension://abc/cb',
    '',
  ])('refuses %s', (uri) => {
    expect(checkRedirectUri(uri).ok).toBe(false);
  });

  it('bounds the list', () => {
    expect(checkRedirectUris([]).ok).toBe(false);
    expect(checkRedirectUris('https://x.com/cb').ok).toBe(false);
    expect(checkRedirectUris(Array.from({ length: 11 }, (_, i) => `https://x.com/cb${i}`)).ok).toBe(false);
  });

  it('matches exactly, except the port of a loopback redirect', () => {
    expect(redirectUriMatches('https://claude.ai/api/mcp/auth_callback', 'https://claude.ai/api/mcp/auth_callback')).toBe(true);
    expect(redirectUriMatches('https://claude.ai/api/mcp/auth_callback', 'https://claude.ai/api/mcp/auth_callback/')).toBe(false);
    expect(redirectUriMatches('https://claude.ai/cb', 'https://claude.ai:8443/cb')).toBe(false);
    expect(redirectUriMatches('http://localhost/callback', 'http://localhost:3118/callback')).toBe(true);
    expect(redirectUriMatches('http://127.0.0.1/callback', 'http://127.0.0.1:52011/callback')).toBe(true);
    expect(redirectUriMatches('http://127.0.0.1:1234/callback', 'http://127.0.0.1:9999/callback')).toBe(true);
    // Host, path and query still have to match.
    expect(redirectUriMatches('http://localhost/callback', 'http://127.0.0.1:3118/callback')).toBe(false);
    expect(redirectUriMatches('http://localhost/callback', 'http://localhost:3118/other')).toBe(false);
    expect(redirectUriMatches('http://localhost/callback', 'http://localhost:3118/callback?x=1')).toBe(false);
    expect(redirectUriMatches('http://localhost/callback', 'http://localhost.evil.com:3118/callback')).toBe(false);
    expect(findMatchingRedirectUri(['https://a.com/cb', 'http://localhost/callback'], 'http://localhost:1/callback')).toBe(
      'http://localhost/callback'
    );
  });

  it('describes the destination for the consent screen', () => {
    expect(redirectDisplay('https://claude.ai/api/mcp/auth_callback')).toEqual({ label: 'claude.ai', loopback: false, app: false });
    expect(redirectDisplay('http://localhost:3118/callback')).toMatchObject({ label: 'localhost:3118', loopback: true });
    expect(redirectDisplay('cursor://anysphere.cursor-retrieval/cb')).toMatchObject({ app: true, label: 'cursor://anysphere.cursor-retrieval' });
  });
});

describe('client registration (RFC 7591)', () => {
  it('accepts a public client and trims its name', () => {
    const parsed = parseRegistrationRequest({
      client_name: `  Cursor‮ ${'x'.repeat(80)}`,
      redirect_uris: ['cursor://anysphere.cursor-retrieval/oauth/callback', 'cursor://anysphere.cursor-retrieval/oauth/callback'],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.input.client_name!.length).toBeLessThanOrEqual(60);
    expect(parsed.input.client_name).not.toMatch(/‮/);
    expect(parsed.input.redirect_uris).toHaveLength(1);
  });

  it('refuses confidential clients, other grants and bad redirect URIs', () => {
    expect(parseRegistrationRequest({ redirect_uris: ['https://a.com/cb'], token_endpoint_auth_method: 'client_secret_basic' })).toMatchObject({
      ok: false,
      error: 'invalid_client_metadata',
    });
    expect(parseRegistrationRequest({ redirect_uris: ['https://a.com/cb'], grant_types: ['client_credentials'] })).toMatchObject({
      ok: false,
    });
    expect(parseRegistrationRequest({ redirect_uris: ['javascript:alert(1)'] })).toMatchObject({ ok: false, error: 'invalid_redirect_uri' });
    expect(parseRegistrationRequest({})).toMatchObject({ ok: false, error: 'invalid_redirect_uri' });
  });

  it('names OAuth keys within the key name limit', () => {
    expect(oauthKeyName('Claude')).toBe('Claude (OAuth)');
    expect(oauthKeyName(null)).toBe('OAuth app (OAuth)');
    expect(oauthKeyName('x'.repeat(60)).length).toBeLessThanOrEqual(64);
    expect(sanitizeClientName('   ')).toBeNull();
  });
});

describe('Client ID Metadata Documents', () => {
  const URL_ID = 'https://claude.ai/oauth/claude-code-client-metadata';
  const DOC = {
    client_id: URL_ID,
    client_name: 'Claude Code',
    redirect_uris: ['http://localhost/callback', 'http://127.0.0.1/callback', 'javascript:alert(1)'],
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    token_endpoint_auth_method: 'none',
  };

  beforeEach(() => clearCimdCache());

  it('recognises URL client ids', () => {
    expect(isCimdClientId(URL_ID)).toBe(true);
    expect(isCimdClientId('https://claude.ai/')).toBe(false);
    expect(isCimdClientId('http://claude.ai/meta')).toBe(false);
    expect(isCimdClientId('https://127.0.0.1/meta')).toBe(false);
    expect(isCimdClientId('https://claude.ai:8443/meta')).toBe(false);
    expect(isCimdClientId('https://claude.ai/a/../meta')).toBe(false);
    expect(isCimdClientId('https://u:p@claude.ai/meta')).toBe(false);
    expect(isCimdClientId('https://localhost/meta')).toBe(false);
  });

  it('validates the document: client_id must equal the URL, bad redirect URIs dropped', () => {
    const parsed = parseCimdDocument(URL_ID, DOC);
    expect(parsed).toMatchObject({
      ok: true,
      client: { kind: 'cimd', client_name: 'Claude Code', metadata_host: 'claude.ai', redirect_uris: ['http://localhost/callback', 'http://127.0.0.1/callback'] },
    });
    expect(parseCimdDocument(URL_ID, { ...DOC, client_id: 'https://evil.example/meta' }).ok).toBe(false);
    expect(parseCimdDocument(URL_ID, { ...DOC, redirect_uris: ['javascript:x'] }).ok).toBe(false);
    expect(parseCimdDocument(URL_ID, { ...DOC, token_endpoint_auth_method: 'private_key_jwt' }).ok).toBe(false);
    expect(parseCimdDocument(URL_ID, [DOC]).ok).toBe(false);
  });

  it('fetches once and caches', async () => {
    const fetcher = vi.fn(async () => ({ status: 200, body: JSON.stringify(DOC), cacheControl: 'max-age=600', contentType: 'application/json' }));
    const now = Date.parse('2026-11-25T12:00:00Z');
    expect((await resolveCimdClient(URL_ID, { fetcher, now })).ok).toBe(true);
    expect((await resolveCimdClient(URL_ID, { fetcher, now: now + 60_000 })).ok).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(1);
    await resolveCimdClient(URL_ID, { fetcher, now: now + 11 * 60_000 });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('reports fetch failures and non-200 answers', async () => {
    expect(await resolveCimdClient(URL_ID, { fetcher: async () => { throw new Error('ENOTPUBLIC'); } })).toMatchObject({ ok: false });
    clearCimdCache();
    expect(
      await resolveCimdClient(URL_ID, { fetcher: async () => ({ status: 302, body: '', cacheControl: null, contentType: null }) })
    ).toMatchObject({ ok: false, reason: expect.stringMatching(/302/) });
    clearCimdCache();
    expect(
      await resolveCimdClient(URL_ID, { fetcher: async () => ({ status: 200, body: '<html>', cacheControl: null, contentType: null }) })
    ).toMatchObject({ ok: false });
  });

  it('only connects to public addresses (SSRF guard)', () => {
    for (const ip of ['8.8.8.8', '160.79.104.10', '2606:4700::1111', '::ffff:8.8.8.8']) expect(isPublicAddress(ip)).toBe(true);
    for (const ip of [
      '127.0.0.1',
      '10.1.2.3',
      '172.16.0.1',
      '172.31.255.255',
      '192.168.0.1',
      '169.254.169.254',
      '100.64.0.1',
      '0.0.0.0',
      '224.0.0.1',
      '::1',
      '::',
      'fe80::1',
      'fd00::1',
      '::ffff:127.0.0.1',
      '::ffff:169.254.169.254',
      '64:ff9b::a9fe:a9fe',
      'not-an-ip',
    ]) {
      expect(isPublicAddress(ip)).toBe(false);
    }
  });
});

describe('PKCE', () => {
  it('verifies S256 only with a well-formed verifier', () => {
    const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
    expect(s256Challenge(verifier)).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
    expect(verifyPkce(verifier, 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM')).toBe(true);
    expect(verifyPkce(verifier + 'x', 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM')).toBe(false);
    expect(verifyPkce('short', s256Challenge('short'))).toBe(false);
    expect(isCodeVerifier('a'.repeat(129))).toBe(false);
  });
});

describe('validateAuthorizeRequest', () => {
  const CLIENT: ClientInfo = {
    client_id: '6f1c2b0e-0f0a-4c55-9a0e-2b8f2f4d1a11',
    kind: 'dcr',
    client_name: 'Cursor',
    redirect_uris: ['https://claude.ai/api/mcp/auth_callback', 'http://127.0.0.1/callback'],
    metadata_host: null,
  };
  const resolveClient = vi.fn(async (id: string) =>
    id === CLIENT.client_id ? ({ ok: true, client: CLIENT } as const) : ({ ok: false, reason: 'Unknown client_id.' } as const)
  );
  const GOOD = {
    response_type: 'code',
    client_id: CLIENT.client_id,
    redirect_uri: 'https://claude.ai/api/mcp/auth_callback',
    code_challenge: 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
    code_challenge_method: 'S256',
    state: 'xyz',
    scope: 'compile offline_access',
    resource: `${ORIGIN}/api/mcp`,
  };
  const validate = (params: Record<string, string | undefined>) => validateAuthorizeRequest(params, { origin: ORIGIN, resolveClient });

  it('accepts a good request', async () => {
    const result = await validate(GOOD);
    expect(result).toMatchObject({ ok: true, request: { scope: 'compile offline_access', state: 'xyz', resource: `${ORIGIN}/api/mcp` } });
  });

  it('shows (never redirects) errors about the client or redirect_uri', async () => {
    expect(await validate({ ...GOOD, client_id: undefined })).toMatchObject({ ok: false, kind: 'page' });
    expect(await validate({ ...GOOD, client_id: 'nope' })).toMatchObject({ ok: false, kind: 'page' });
    expect(await validate({ ...GOOD, redirect_uri: undefined })).toMatchObject({ ok: false, kind: 'page' });
    expect(await validate({ ...GOOD, redirect_uri: 'https://evil.example/cb' })).toMatchObject({ ok: false, kind: 'page' });
  });

  it('accepts a loopback redirect on any port', async () => {
    expect((await validate({ ...GOOD, redirect_uri: 'http://127.0.0.1:61234/callback' })).ok).toBe(true);
  });

  it.each([
    [{ response_type: 'token' }, 'unsupported_response_type'],
    [{ code_challenge: undefined }, 'invalid_request'],
    [{ code_challenge_method: 'plain' }, 'invalid_request'],
    [{ code_challenge_method: undefined }, 'invalid_request'],
    [{ code_challenge: 'too-short' }, 'invalid_request'],
    [{ resource: 'https://other.example/mcp' }, 'invalid_target'],
  ])('redirects %o back with %s, state and iss', async (patch, error) => {
    const result = await validate({ ...GOOD, ...patch });
    expect(result).toMatchObject({ ok: false, kind: 'redirect' });
    if (result.ok || result.kind !== 'redirect') return;
    const url = new URL(result.location);
    expect(url.origin + url.pathname).toBe('https://claude.ai/api/mcp/auth_callback');
    expect(url.searchParams.get('error')).toBe(error);
    expect(url.searchParams.get('state')).toBe('xyz');
    expect(url.searchParams.get('iss')).toBe(ORIGIN);
  });

  it('picks only known parameters', () => {
    expect(pickAuthorizeParams({ client_id: ['a', 'b'], foo: 'bar', state: '' })).toEqual({ client_id: 'a' });
    expect(buildClientRedirect('cursor://x/cb?keep=1', { code: 'c', state: null }, ORIGIN)).toBe(
      'cursor://x/cb?keep=1&code=c&iss=https%3A%2F%2Fapp.useoctree.com'
    );
  });
});

describe('consent form protection', () => {
  const params = { client_id: 'c', redirect_uri: 'https://claude.ai/cb', code_challenge: 'x' };

  it('binds the token to user and parameters, and expires it', () => {
    const now = Date.now();
    const token = createConsentToken('secret', 'user-1', params, now);
    expect(verifyConsentToken('secret', token, 'user-1', params, now)).toBe(true);
    expect(verifyConsentToken('secret', token, 'user-2', params, now)).toBe(false);
    expect(verifyConsentToken('secret', token, 'user-1', { ...params, redirect_uri: 'https://evil.example/cb' }, now)).toBe(false);
    expect(verifyConsentToken('other', token, 'user-1', params, now)).toBe(false);
    expect(verifyConsentToken('secret', token, 'user-1', params, now + 11 * 60_000)).toBe(false);
    expect(verifyConsentToken('secret', 'garbage', 'user-1', params, now)).toBe(false);
  });

  it('requires a same-origin POST', () => {
    expect(isSameOriginPost(new Headers({ origin: ORIGIN }), ORIGIN)).toBe(true);
    expect(isSameOriginPost(new Headers({ origin: 'https://evil.example' }), ORIGIN)).toBe(false);
    expect(isSameOriginPost(new Headers({ 'sec-fetch-site': 'same-origin' }), ORIGIN)).toBe(true);
    expect(isSameOriginPost(new Headers({ 'sec-fetch-site': 'cross-site' }), ORIGIN)).toBe(false);
    expect(isSameOriginPost(new Headers(), ORIGIN)).toBe(false);
  });

  it('derives the origin from the host header, not the Tools proxy forwarded host', () => {
    expect(originFromHeaders(new Headers({ host: 'app.useoctree.com', 'x-forwarded-host': 'tools.useoctree.com', 'x-forwarded-proto': 'https' }))).toBe(ORIGIN);
    expect(originFromHeaders(new Headers({ host: 'localhost:3000' }))).toBe('http://localhost:3000');
  });
});
