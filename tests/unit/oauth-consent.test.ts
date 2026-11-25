import { describe, it, expect, vi } from 'vitest';
import {
  consentPath,
  describeRedirect,
  describeScopes,
  isValidAuthorizationId,
  loginPathForConsent,
  parseDecision,
  resolveConsentView,
  runConsentDecision,
} from '@/lib/oauth/consent';

const ID = '8b3f0d2e-5d4c-4f7a-9a51-0c6c0f1b2a3d';

describe('consent helpers', () => {
  it('validates authorization ids', () => {
    expect(isValidAuthorizationId(ID)).toBe(true);
    expect(isValidAuthorizationId('short')).toBe(false);
    expect(isValidAuthorizationId('../../etc')).toBe(false);
    expect(isValidAuthorizationId(['a'])).toBe(false);
  });

  it('sends signed-out users to login and back to this request', () => {
    expect(consentPath(ID)).toBe(`/oauth/consent?authorization_id=${ID}`);
    expect(loginPathForConsent(ID)).toBe(`/auth/login?next=${encodeURIComponent(`/oauth/consent?authorization_id=${ID}`)}`);
  });

  it('describes scopes and redirect hosts, flagging loopback clients', () => {
    expect(describeScopes('openid email email custom:x')).toEqual([
      { scope: 'openid', label: 'Confirm your Octree identity' },
      { scope: 'email', label: 'See your email address' },
      { scope: 'custom:x', label: 'custom:x' },
    ]);
    expect(describeScopes(undefined)).toEqual([]);
    expect(describeRedirect('https://claude.ai/api/mcp/auth_callback')).toEqual({ host: 'claude.ai', loopback: false });
    expect(describeRedirect('http://localhost:3118/callback')).toEqual({ host: 'localhost:3118', loopback: true });
    expect(describeRedirect('http://127.0.0.1:5000/cb')).toEqual({ host: '127.0.0.1:5000', loopback: true });
    expect(describeRedirect('not a url')).toBeNull();
  });

  it('parses decisions', () => {
    expect(parseDecision('approve')).toBe('approve');
    expect(parseDecision('deny')).toBe('deny');
    expect(parseDecision('yes')).toBeNull();
  });
});

describe('resolveConsentView', () => {
  it('shows the client, scopes and redirect host', () => {
    const view = resolveConsentView(
      {
        data: {
          authorization_id: ID,
          redirect_uri: 'https://claude.ai/api/mcp/auth_callback',
          scope: 'email',
          client: { id: 'c1', name: 'Claude', uri: 'https://claude.ai', logo_uri: 'https://claude.ai/logo.png' },
        },
        error: null,
      },
      ID
    );
    expect(view).toEqual({
      kind: 'consent',
      authorizationId: ID,
      clientName: 'Claude',
      clientHost: 'claude.ai',
      logoUri: 'https://claude.ai/logo.png',
      scopes: [{ scope: 'email', label: 'See your email address' }],
      redirect: { host: 'claude.ai', loopback: false },
    });
  });

  it('goes straight back when the user already consented', () => {
    expect(resolveConsentView({ data: { redirect_url: 'https://claude.ai/api/mcp/auth_callback?code=x' }, error: null }, ID)).toEqual({
      kind: 'redirect',
      url: 'https://claude.ai/api/mcp/auth_callback?code=x',
    });
  });

  it('is an error for unknown or expired requests, and drops unsafe logos and names', () => {
    expect(resolveConsentView({ data: null, error: { message: 'not found' } }, ID).kind).toBe('error');
    const view = resolveConsentView(
      { data: { authorization_id: ID, client: { name: '  ', logo_uri: 'javascript:alert(1)' } }, error: null },
      ID
    );
    expect(view).toMatchObject({ kind: 'consent', clientName: 'An application', logoUri: null, redirect: null });
  });
});

describe('runConsentDecision', () => {
  const api = (result: { data: { redirect_url: string } | null; error: { message: string } | null }) => ({
    approveAuthorization: vi.fn(async () => result),
    denyAuthorization: vi.fn(async () => result),
  });

  it('approves without a browser redirect and returns the client redirect URL', async () => {
    const oauth = api({ data: { redirect_url: 'https://claude.ai/api/mcp/auth_callback?code=abc&state=s' }, error: null });
    expect(await runConsentDecision(oauth, ID, 'approve')).toBe('https://claude.ai/api/mcp/auth_callback?code=abc&state=s');
    expect(oauth.approveAuthorization).toHaveBeenCalledWith(ID, { skipBrowserRedirect: true });
    expect(oauth.denyAuthorization).not.toHaveBeenCalled();
  });

  it('denies through denyAuthorization', async () => {
    const oauth = api({ data: { redirect_url: 'http://localhost:3118/callback?error=access_denied' }, error: null });
    expect(await runConsentDecision(oauth, ID, 'deny')).toBe('http://localhost:3118/callback?error=access_denied');
    expect(oauth.denyAuthorization).toHaveBeenCalledWith(ID, { skipBrowserRedirect: true });
  });

  it('comes back to the consent page on failure or an unsafe redirect', async () => {
    const failed = api({ data: null, error: { message: 'authorization expired' } });
    expect(await runConsentDecision(failed, ID, 'approve')).toBe(`/oauth/consent?authorization_id=${ID}&error=decision_failed`);
    const weird = api({ data: { redirect_url: 'javascript:alert(1)' }, error: null });
    expect(await runConsentDecision(weird, ID, 'approve')).toMatch(/error=decision_failed$/);
  });
});
