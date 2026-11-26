import { describe, expect, it } from 'vitest';
import { exactRedirect } from '@/lib/auth/redirect';
import { redirectUriMatches } from '@/lib/oauth/redirect-uri';

describe('loopback redirect handling', () => {
  it('exactRedirect keeps 127.0.0.1 inside a next query untouched', () => {
    const next = '/oauth/authorize?redirect_uri=http%3A%2F%2F127.0.0.1%3A53682%2Fcallback&state=x';
    const res = exactRedirect(next);
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toBe(next);
    expect(exactRedirect('https://app.example/x?u=http://127.0.0.1:5/cb', 303).headers.get('location')).toContain('127.0.0.1');
  });

  it('treats loopback hosts as equivalent and ignores the port', () => {
    expect(redirectUriMatches('http://127.0.0.1:1234/callback', 'http://localhost:53682/callback')).toBe(true);
    expect(redirectUriMatches('http://localhost/callback', 'http://127.0.0.1:9/callback')).toBe(true);
    expect(redirectUriMatches('http://[::1]:1/callback', 'http://127.0.0.1:2/callback')).toBe(true);
  });

  it('still requires the same path and query, and never matches a non-loopback host', () => {
    expect(redirectUriMatches('http://127.0.0.1:1/callback', 'http://localhost:2/other')).toBe(false);
    expect(redirectUriMatches('http://127.0.0.1:1/callback', 'http://evil.example:2/callback')).toBe(false);
    expect(redirectUriMatches('http://127.0.0.1:1/callback', 'https://localhost:2/callback')).toBe(false);
  });
});

import { effectiveRedirectUri } from '@/lib/oauth/redirect-uri';
describe('effectiveRedirectUri', () => {
  it('puts back the registered loopback host, keeping the presented port', () => {
    expect(effectiveRedirectUri('http://127.0.0.1:1/callback', 'http://localhost:53682/callback')).toBe('http://127.0.0.1:53682/callback');
    expect(effectiveRedirectUri('http://localhost/callback', 'http://127.0.0.1:9/callback')).toBe('http://localhost:9/callback');
  });
  it('leaves non-loopback and same-host URIs alone', () => {
    expect(effectiveRedirectUri('https://claude.ai/cb', 'https://claude.ai/cb')).toBe('https://claude.ai/cb');
    expect(effectiveRedirectUri('cursor://x/cb', 'cursor://x/cb')).toBe('cursor://x/cb');
    expect(effectiveRedirectUri('http://127.0.0.1:1/cb', 'http://127.0.0.1:5/cb')).toBe('http://127.0.0.1:5/cb');
  });
});
