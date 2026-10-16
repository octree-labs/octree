import { describe, it, expect } from 'vitest';
import { buildRedirectUrl, resolveRedirectBase } from '../redirect';

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
