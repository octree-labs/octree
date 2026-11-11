import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * lib/utils/compilation.ts: a request over the compile service's 64 MB cap
 * is refused in the browser, before any upload, with the files to blame.
 */

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({ auth: { getSession: async () => ({ data: { session: null } }) } }),
}));

const MB = 1024 * 1024;

describe('makeCompilationRequest size cap', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.resetModules();
    process.env.NEXT_PUBLIC_COMPILE_SERVICE_URL = 'https://compile.test';
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('refuses an oversized project without calling the service', async () => {
    const { makeCompilationRequest, COMPILE_MAX_REQUEST_BYTES } = await import('@/lib/utils/compilation');
    const files = [
      { path: 'main.tex', content: '\\documentclass{article}' },
      { path: 'figures/scan.png', content: 'A'.repeat(COMPILE_MAX_REQUEST_BYTES), encoding: 'base64' },
      { path: 'figures/small.png', content: 'B'.repeat(MB), encoding: 'base64' },
    ];
    const { response, data } = await makeCompilationRequest(files, 'main.tex', 'p1');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(response.status).toBe(413);
    expect(data.error).toBe('Project too large to compile');
    expect(data.details).toContain('the limit is 64 MB');
    expect(data.details).toContain('figures/scan.png (64.0 MB)');
    expect(data.details.indexOf('figures/scan.png')).toBeLessThan(data.details.indexOf('figures/small.png'));
  });

  it('describes the request with its total size and the three largest files', async () => {
    const { describeOversizedRequest } = await import('@/lib/utils/compilation');
    const files = ['a', 'b', 'c', 'd'].map((name, i) => ({
      path: `${name}.png`,
      content: 'x'.repeat((i + 1) * 100),
    }));
    const { error, details } = describeOversizedRequest(files, 70 * MB);
    expect(error).toBe('Project too large to compile');
    expect(details).toMatch(/^The compile request is 70\.0 MB; the limit is 64 MB\. Largest files: d\.png \(0\.0 MB\), c\.png \(0\.0 MB\), b\.png \(0\.0 MB\)\./);
  });
});
