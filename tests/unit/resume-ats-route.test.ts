import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * app/api/resume/ats: signed in, Pro (same entitlement rule as the rest of
 * the app), the user's own resume project, and sane input, before any model
 * call; the report is saved as the project's latest. Supabase and the
 * analysis are mocked.
 */

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  usageRow: vi.fn(),
  project: vi.fn(),
  analyzeResume: vi.fn(),
  hasUnlimitedEdits: vi.fn(),
  upsert: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: mocks.getUser },
    from: (table: string) => {
      const chain = {
        select: () => chain,
        eq: () => chain,
        maybeSingle: async () => ({ data: table === 'user_usage' ? mocks.usageRow() : mocks.project() }),
        upsert: async (row: unknown, options: unknown) => mocks.upsert(table, row, options),
      };
      return chain;
    },
  }),
}));

vi.mock('@/lib/paywall', () => ({ hasUnlimitedEdits: mocks.hasUnlimitedEdits }));

vi.mock('@/lib/resume/ats/analyze', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/resume/ats/analyze')>()),
  analyzeResume: mocks.analyzeResume,
}));

import { createHash } from 'node:crypto';
import { POST } from '@/app/api/resume/ats/route';
import { AtsInputError } from '@/lib/resume/ats/analyze';

const PROJECT_ID = '3f2b7a1e-9c4d-4e8f-a1b2-c3d4e5f6a7b8';
const PDF = Buffer.from('%PDF-1.7 resume').toString('base64');
const PRO_ROW = {
  is_pro: true,
  subscription_status: 'active',
  stripe_subscription_id: 'sub_1',
  current_period_end: '2099-01-01T00:00:00Z',
};
const REPORT = { score: 80, scores: { parsing: 90, content: 70, jobMatch: null }, checks: [], issues: [], jobMatch: null };

function post(body: Record<string, unknown>) {
  return new Request('http://localhost/api/resume/ats', {
    method: 'POST',
    body: JSON.stringify({ projectId: PROJECT_ID, tex: '\\documentclass{article}', pdf: PDF, ...body }),
  });
}

describe('POST /api/resume/ats', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getUser.mockResolvedValue({ data: { user: { id: 'user-1', email: 'pro@example.com' } } });
    mocks.hasUnlimitedEdits.mockReturnValue(false);
    mocks.usageRow.mockReturnValue(PRO_ROW);
    mocks.project.mockReturnValue({ id: PROJECT_ID, kind: 'resume' });
    mocks.analyzeResume.mockResolvedValue(REPORT);
    mocks.upsert.mockResolvedValue({ error: null });
  });

  const TEX_HASH = createHash('sha256').update('\\documentclass{article}').digest('hex');

  it('analyzes for a Pro user, saves the report and returns it with the source hash', async () => {
    const response = await POST(post({ jobDescription: '  Kubernetes  ' }));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ report: REPORT, jobDescription: 'Kubernetes', texHash: TEX_HASH, analyzedAt: expect.any(String) });
    expect(mocks.analyzeResume).toHaveBeenCalledWith(
      expect.objectContaining({ tex: '\\documentclass{article}', jobDescription: 'Kubernetes' })
    );
    const { pdf } = mocks.analyzeResume.mock.calls[0][0];
    expect(Buffer.from(pdf).toString()).toBe('%PDF-1.7 resume');
    expect(mocks.upsert).toHaveBeenCalledWith(
      'resume_ats_reports',
      {
        project_id: PROJECT_ID,
        user_id: 'user-1',
        report: REPORT,
        job_description: 'Kubernetes',
        tex_hash: TEX_HASH,
        updated_at: body.analyzedAt,
      },
      { onConflict: 'project_id' }
    );
  });

  it('stores no job description when it is blank', async () => {
    const body = await (await POST(post({ jobDescription: '   ' }))).json();
    expect(body.jobDescription).toBeNull();
    expect(mocks.analyzeResume).toHaveBeenCalledWith(expect.objectContaining({ jobDescription: null }));
  });

  it('still returns the report when saving it fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.upsert.mockResolvedValue({ error: { message: 'relation does not exist' } });
    const response = await POST(post({}));
    expect(response.status).toBe(200);
    expect((await response.json()).report).toEqual(REPORT);
  });

  it('rejects a signed-out request', async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null } });
    expect((await POST(post({}))).status).toBe(401);
  });

  it('refuses a free user with upgradeRequired, before any analysis', async () => {
    mocks.usageRow.mockReturnValue({ is_pro: false, subscription_status: 'inactive' });
    const response = await POST(post({}));
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ upgradeRequired: true });
    expect(mocks.analyzeResume).not.toHaveBeenCalled();
  });

  it('refuses a bare is_pro flag with no live subscription', async () => {
    mocks.usageRow.mockReturnValue({ is_pro: true, subscription_status: 'canceled', stripe_subscription_id: null });
    expect((await POST(post({}))).status).toBe(403);
  });

  it('lets an allowlisted account through without a usage row', async () => {
    mocks.hasUnlimitedEdits.mockReturnValue(true);
    mocks.usageRow.mockReturnValue(null);
    expect((await POST(post({}))).status).toBe(200);
  });

  it('404s a project the user does not own and 400s one that is not a resume', async () => {
    mocks.project.mockReturnValueOnce(null);
    expect((await POST(post({}))).status).toBe(404);
    mocks.project.mockReturnValueOnce({ id: PROJECT_ID, kind: null });
    expect((await POST(post({}))).status).toBe(400);
    expect(mocks.analyzeResume).not.toHaveBeenCalled();
  });

  it.each([
    ['a non-uuid project id', { projectId: 'abc' }],
    ['empty LaTeX', { tex: '  ' }],
    ['no PDF', { pdf: '' }],
    ['a file that is not a PDF', { pdf: Buffer.from('<html>').toString('base64') }],
    ['a job description over the limit', { jobDescription: 'x'.repeat(20_001) }],
    ['a non-string job description', { jobDescription: 42 }],
  ])('400s %s', async (_label, body) => {
    expect((await POST(post(body))).status).toBe(400);
    expect(mocks.analyzeResume).not.toHaveBeenCalled();
  });

  it('shows input errors from the analysis and hides other failures', async () => {
    mocks.analyzeResume.mockRejectedValueOnce(new AtsInputError('This PDF has 6 pages.'));
    const tooLong = await POST(post({}));
    expect(tooLong.status).toBe(400);
    expect(await tooLong.json()).toEqual({ error: 'This PDF has 6 pages.' });
    expect(mocks.upsert).not.toHaveBeenCalled();

    vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.analyzeResume.mockRejectedValueOnce(new Error('model overloaded'));
    const failed = await POST(post({}));
    expect(failed.status).toBe(500);
    expect((await failed.json()).error).not.toContain('overloaded');
  });
});
