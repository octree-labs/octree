import { describe, it, expect } from 'vitest';
import { buildRedirectUrl, resolveRedirectBase, safeRedirectPath } from '@/lib/auth/redirect';

describe('Redirect URL handling', () => {
  it('prefers the direct host header over forwarded host', () => {
    const headers = new Headers({
      host: 'ai-latex-editor.useoctree.com',
      'x-forwarded-host': 'tools.useoctree.com',
      'x-forwarded-proto': 'https',
    });

    const base = resolveRedirectBase(headers, new URL('https://ai-latex-editor.useoctree.com/auth/oauth'));
    expect(base.origin).toBe('https://ai-latex-editor.useoctree.com');

    const redirect = buildRedirectUrl(headers, 'https://ai-latex-editor.useoctree.com', '/projects/123');
    expect(redirect).toBe('https://ai-latex-editor.useoctree.com/projects/123');
  });

  it('falls back to origin host when proxy host differs', () => {
    const headers = new Headers({
      host: 'tools.useoctree.com',
      'x-forwarded-host': 'app.useoctree.com',
      'x-forwarded-proto': 'https',
    });

    const base = resolveRedirectBase(headers, new URL('https://app.useoctree.com/auth/oauth'));
    expect(base.origin).toBe('https://app.useoctree.com');

    const redirect = buildRedirectUrl(headers, 'https://app.useoctree.com', '/projects/123');
    expect(redirect).toBe('https://app.useoctree.com/projects/123');
  });

  it('falls back to forwarded host when allow-listed', () => {
    const headers = new Headers({
      'x-forwarded-host': 'preview.ai-latex-editor.vercel.app',
      'x-forwarded-proto': 'https',
    });

    const base = resolveRedirectBase(
      headers,
      new URL('https://ai-latex-editor.useoctree.com/auth/oauth'),
      'preview.ai-latex-editor.vercel.app'
    );
    expect(base.origin).toBe('https://preview.ai-latex-editor.vercel.app');

    const redirect = buildRedirectUrl(
      headers,
      'https://ai-latex-editor.useoctree.com',
      '/projects/123',
      'preview.ai-latex-editor.vercel.app'
    );
    expect(redirect).toBe('https://preview.ai-latex-editor.vercel.app/projects/123');
  });

  it('defaults to origin host when no candidate is allow-listed', () => {
    const headers = new Headers({
      host: 'internal.vercel.app',
      'x-forwarded-host': 'example.com',
      'x-forwarded-proto': 'https',
    });

    const base = resolveRedirectBase(headers, new URL('https://ai-latex-editor.useoctree.com/auth/oauth'));
    expect(base.origin).toBe('https://ai-latex-editor.useoctree.com');
  });
});

describe('safeRedirectPath', () => {
  it.each([
    '//evil.com',
    '//evil.com/path',
    '/\\evil.com',
    '/\\/evil.com',
    'https://evil.com',
    'http:/evil.com',
    'javascript:alert(1)',
    '/\t/evil.com',
    '/\n/evil.com',
    '/\r\n/evil.com',
    ' /projects',
    '/a/..//evil.com',
    '',
    'projects/x',
  ])('rejects %j', (value) => {
    expect(safeRedirectPath(value)).toBeNull();
  });

  it('rejects non-strings', () => {
    expect(safeRedirectPath(undefined)).toBeNull();
    expect(safeRedirectPath(null)).toBeNull();
    expect(safeRedirectPath(['/x'])).toBeNull();
  });

  it('keeps an encoded slash path on the same origin', () => {
    expect(safeRedirectPath('/%2F%2Fevil.com')).toBe('/%2F%2Fevil.com');
    expect(buildRedirectUrl(new Headers({ host: 'app.useoctree.com' }), 'https://app.useoctree.com', '/%2F%2Fevil.com'))
      .toBe('https://app.useoctree.com/%2F%2Fevil.com');
  });

  it('keeps normal in-app paths with query and hash', () => {
    expect(safeRedirectPath('/projects/x?y=1#z')).toBe('/projects/x?y=1#z');
    expect(safeRedirectPath('/')).toBe('/');
    expect(safeRedirectPath('/import?draft=abc')).toBe('/import?draft=abc');
  });

  it('keeps a path whose query has a decoded space', () => {
    expect(safeRedirectPath('/generate?q=a b')).toBe('/generate?q=a%20b');
  });

  it('reduces a same-origin absolute URL to its path when an origin is given', () => {
    const origin = 'https://app.useoctree.com';
    expect(safeRedirectPath('https://app.useoctree.com/auth/update-password', origin)).toBe('/auth/update-password');
    expect(safeRedirectPath('https://app.useoctree.com/import?draft=abc#h', origin)).toBe('/import?draft=abc#h');
    expect(safeRedirectPath('https://evil.com/auth/update-password', origin)).toBeNull();
    expect(safeRedirectPath('https://app.useoctree.com/\t/evil.com', origin)).toBeNull();
    expect(safeRedirectPath('javascript:alert(1)', origin)).toBeNull();
    expect(safeRedirectPath('https://app.useoctree.com/x')).toBeNull();
  });

  it('buildRedirectUrl never leaves the origin for a hostile next', () => {
    const headers = new Headers({ host: 'app.useoctree.com', 'x-forwarded-proto': 'https' });
    for (const next of ['//evil.com', '/\\evil.com', 'https://evil.com', '/\t/evil.com']) {
      expect(buildRedirectUrl(headers, 'https://app.useoctree.com', next)).toBe('https://app.useoctree.com/');
    }
  });
});
