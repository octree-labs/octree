import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * app/api/import/preview/[draftId]/route.ts serves the guest PDF preview.
 * The helper is mocked; the tests pin the status codes, the headers the
 * browser and crawlers see, and the per-IP limiter.
 */

const mocks = vi.hoisted(() => ({
  renderImportPreview: vi.fn(),
}));

vi.mock('@/lib/import/preview', () => ({
  renderImportPreview: mocks.renderImportPreview,
}));

vi.mock('@/lib/posthog-server', () => ({
  captureServerExceptionAfterResponse: vi.fn(),
}));

import { GET } from '@/app/api/import/preview/[draftId]/route';

const DRAFT_ID = '11111111-2222-4333-8444-555555555555';
const PDF = Buffer.from('%PDF-1.5\n%fake\n');

let ipCounter = 0;

function get(draftId: string, ip = `203.0.113.${++ipCounter}`) {
  const request = new Request(`https://app.useoctree.com/api/import/preview/${draftId}`, {
    headers: { 'x-forwarded-for': ip },
  });
  return GET(request, { params: Promise.resolve({ draftId }) });
}

describe('GET /api/import/preview/[draftId]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns the PDF inline with private caching and noindex', async () => {
    mocks.renderImportPreview.mockResolvedValue({ ok: true, pdf: PDF, cached: false, title: 'Doc', source: 'tools:x' });

    const res = await get(DRAFT_ID);

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/pdf');
    expect(res.headers.get('cache-control')).toBe('private, max-age=3600');
    expect(res.headers.get('x-robots-tag')).toBe('noindex, nofollow');
    expect(res.headers.get('content-disposition')).toBe('inline; filename="preview.pdf"');
    expect(res.headers.get('x-preview-cache')).toBe('miss');
    expect(Buffer.from(await res.arrayBuffer())).toEqual(PDF);
    expect(mocks.renderImportPreview).toHaveBeenCalledWith(DRAFT_ID);
  });

  it('returns 404 for an unknown draft', async () => {
    mocks.renderImportPreview.mockResolvedValue({ ok: false, reason: 'not_found' });

    const res = await get(DRAFT_ID);

    expect(res.status).toBe(404);
    expect(res.headers.get('x-robots-tag')).toBe('noindex, nofollow');
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    expect(await res.json()).toEqual({ error: 'Draft not found' });
  });

  it('returns the same 404 for consumed and expired drafts', async () => {
    mocks.renderImportPreview.mockResolvedValue({ ok: false, reason: 'consumed' });
    expect((await get(DRAFT_ID)).status).toBe(404);
    mocks.renderImportPreview.mockResolvedValue({ ok: false, reason: 'expired' });
    expect((await get(DRAFT_ID)).status).toBe(404);
  });

  it('returns 404 without touching the helper when the id is not a uuid', async () => {
    const res = await get('..%2F..%2Fetc%2Fpasswd');

    expect(res.status).toBe(404);
    expect(mocks.renderImportPreview).not.toHaveBeenCalled();
  });

  it('returns 422 with the error lines when the LaTeX does not compile', async () => {
    mocks.renderImportPreview.mockResolvedValue({
      ok: false,
      reason: 'compile_failed',
      errorLines: ['! Undefined control sequence.'],
    });

    const res = await get(DRAFT_ID);

    expect(res.status).toBe(422);
    expect(res.headers.get('cache-control')).toBe('private, max-age=3600');
    expect(await res.json()).toEqual({
      error: 'Compile failed',
      reason: 'compile_failed',
      lines: ['! Undefined control sequence.'],
    });
  });

  it('returns 503 with Retry-After when the compile service is unavailable or the helper throws', async () => {
    mocks.renderImportPreview.mockResolvedValue({ ok: false, reason: 'unavailable' });
    const res = await get(DRAFT_ID);
    expect(res.status).toBe(503);
    expect(res.headers.get('retry-after')).toBe('30');

    mocks.renderImportPreview.mockRejectedValue(new Error('boom'));
    const thrown = await get(DRAFT_ID);
    expect(thrown.status).toBe(503);
  });

  it('limits one IP to 10 requests a minute', async () => {
    mocks.renderImportPreview.mockResolvedValue({ ok: false, reason: 'not_found' });
    const ip = '198.51.100.77';

    for (let i = 0; i < 10; i++) {
      expect((await get(DRAFT_ID, ip)).status).toBe(404);
    }
    const limited = await get(DRAFT_ID, ip);

    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get('retry-after'))).toBeGreaterThan(0);
    expect(mocks.renderImportPreview).toHaveBeenCalledTimes(10);

    // Another IP is unaffected.
    expect((await get(DRAFT_ID, '198.51.100.78')).status).toBe(404);
  });
});
