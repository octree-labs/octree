// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const mocks = vi.hoisted(() => ({ cleanup: vi.fn() }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({}) }));
vi.mock('@/lib/api/artifacts', () => ({ cleanupApiArtifacts: mocks.cleanup }));

import { GET } from '@/app/api/cron/api-artifacts/route';

const ENV = { ...process.env };

describe('GET /api/cron/api-artifacts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CRON_SECRET = 'cron-secret';
    mocks.cleanup.mockResolvedValue({ deleted: 2, days_scanned: 1, truncated: false });
  });
  afterEach(() => {
    process.env = { ...ENV };
  });

  it('requires the cron secret', async () => {
    const response = await GET(new Request('https://x/api/cron/api-artifacts'));
    expect(response.status).toBe(401);
    expect(mocks.cleanup).not.toHaveBeenCalled();
  });

  it('runs the cleanup (dry with ?dry=1)', async () => {
    const auth = { headers: { Authorization: 'Bearer cron-secret' } };
    const response = await GET(new Request('https://x/api/cron/api-artifacts', auth));
    expect(await response.json()).toEqual({ ok: true, dry: false, deleted: 2, days_scanned: 1, truncated: false });
    await GET(new Request('https://x/api/cron/api-artifacts?dry=1', auth));
    expect(mocks.cleanup).toHaveBeenLastCalledWith(expect.anything(), expect.any(Date), true);
  });

  it('is scheduled in vercel.json', () => {
    const config = JSON.parse(readFileSync(join(__dirname, '../../vercel.json'), 'utf8'));
    expect(config.crons).toContainEqual({ path: '/api/cron/api-artifacts', schedule: expect.stringMatching(/^\d+ \* \* \* \*$/) });
  });
});

describe('api artifacts migration', () => {
  const sql = readFileSync(
    join(__dirname, '../../supabase/migrations/20261127000000_api_artifacts.sql'),
    'utf8'
  ).toLowerCase();

  it('creates a private PDF-only bucket without storage policies', () => {
    expect(sql).toMatch(/values \('api-artifacts', 'api-artifacts', false, \d+, array\['application\/pdf'\]\)/);
    expect(sql).not.toMatch(/create policy/);
  });

  it('adds the checks counter behind a service-role-only function', () => {
    expect(sql).toContain('add column if not exists checks integer not null default 0');
    expect(sql).toContain('revoke execute on function public.increment_api_check_usage(uuid, date) from public, anon, authenticated');
    expect(sql).toContain('grant execute on function public.increment_api_check_usage(uuid, date) to service_role');
  });
});
