// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import {
  API_ARTIFACTS_BUCKET,
  apiArtifactPath,
  cleanupApiArtifacts,
  storeApiPdf,
} from '@/lib/api/artifacts';

type Entry = { name: string; id: string | null; created_at?: string };

/** An in-memory bucket with the storage-js calls the module uses. */
function fakeStorage(objects: Record<string, string>) {
  const removed: string[] = [];
  const bucket = {
    upload: vi.fn(async () => ({ data: { path: 'x' }, error: null })),
    createSignedUrl: vi.fn(async (path: string, ttl: number) => ({ data: { signedUrl: `https://sb/sign/${path}?ttl=${ttl}` }, error: null })),
    list: vi.fn(async (prefix: string, opts: { limit: number; offset: number }) => {
      const depth = prefix === '' ? 0 : prefix.split('/').length;
      const seen = new Map<string, Entry>();
      for (const [path, created] of Object.entries(objects)) {
        if (removed.includes(path)) continue;
        const parts = path.split('/');
        if (prefix && parts.slice(0, depth).join('/') !== prefix) continue;
        const name = parts[depth];
        const isFile = depth === parts.length - 1;
        seen.set(name, isFile ? { name, id: `id-${path}`, created_at: created } : { name, id: null });
      }
      return { data: [...seen.values()].slice(opts.offset, opts.offset + opts.limit), error: null };
    }),
    remove: vi.fn(async (paths: string[]) => {
      removed.push(...paths);
      return { data: [], error: null };
    }),
  };
  const client = { storage: { from: vi.fn(() => bucket) } };
  return { client: client as never, bucket, removed, from: client.storage.from };
}

describe('apiArtifactPath', () => {
  it('is <UTC day>/<user>/<uuid>.pdf', () => {
    expect(apiArtifactPath('u1', new Date('2026-11-25T23:59:00Z'), 'abc')).toBe('2026-11-25/u1/abc.pdf');
    expect(apiArtifactPath('u1')).toMatch(/^\d{4}-\d{2}-\d{2}\/u1\/[0-9a-f-]{36}\.pdf$/);
  });
});

describe('storeApiPdf', () => {
  it('uploads to the private bucket and signs for one hour', async () => {
    const { client, bucket, from } = fakeStorage({});
    const now = new Date('2026-11-25T12:00:00Z');
    const stored = await storeApiPdf(client, 'u1', Buffer.from('%PDF'), now);
    expect(from).toHaveBeenCalledWith(API_ARTIFACTS_BUCKET);
    expect(bucket.upload).toHaveBeenCalledWith(expect.stringMatching(/^2026-11-25\/u1\/.+\.pdf$/), expect.anything(), {
      contentType: 'application/pdf',
      upsert: false,
      cacheControl: '3600',
    });
    expect(stored).toMatchObject({ url: expect.stringContaining('ttl=3600'), expires_at: '2026-11-25T13:00:00.000Z' });
  });

  it('returns null instead of throwing when storage fails', async () => {
    const { client, bucket } = fakeStorage({});
    bucket.upload.mockResolvedValueOnce({ data: null, error: { message: 'Bucket not found' } } as never);
    expect(await storeApiPdf(client, 'u1', Buffer.from('%PDF'))).toBeNull();
    bucket.createSignedUrl.mockRejectedValueOnce(new Error('network'));
    expect(await storeApiPdf(client, 'u1', Buffer.from('%PDF'))).toBeNull();
  });

  it('gives up with null when storage stalls', async () => {
    const { client, bucket } = fakeStorage({});
    bucket.upload.mockImplementationOnce(() => new Promise(() => {}) as never);
    expect(await storeApiPdf(client, 'u1', Buffer.from('%PDF'), new Date(), 20)).toBeNull();
  });
});

describe('cleanupApiArtifacts', () => {
  const now = new Date('2026-11-25T12:00:00Z');
  const objects = {
    '2026-11-23/u1/a.pdf': '2026-11-23T08:00:00Z', // whole day expired
    '2026-11-23/u2/b.pdf': '2026-11-23T20:00:00Z',
    '2026-11-24/u1/c.pdf': '2026-11-24T10:00:00Z', // older than 24h
    '2026-11-24/u1/d.pdf': '2026-11-24T13:00:00Z', // 23h old: kept
    '2026-11-25/u1/e.pdf': '2026-11-25T11:00:00Z', // today: kept
  };

  it('deletes objects older than 24 hours and keeps the rest', async () => {
    const { client, removed } = fakeStorage(objects);
    const result = await cleanupApiArtifacts(client, now);
    expect(removed.sort()).toEqual(['2026-11-23/u1/a.pdf', '2026-11-23/u2/b.pdf', '2026-11-24/u1/c.pdf']);
    expect(result).toEqual({ deleted: 3, days_scanned: 2, truncated: false });
  });

  it('counts without deleting on a dry run', async () => {
    const { client, removed, bucket } = fakeStorage(objects);
    expect(await cleanupApiArtifacts(client, now, true)).toMatchObject({ deleted: 3 });
    expect(removed).toEqual([]);
    expect(bucket.remove).not.toHaveBeenCalled();
  });

  it('ignores entries that are not day folders', async () => {
    const { client, removed } = fakeStorage({ 'stray/u1/x.pdf': '2020-01-01T00:00:00Z' });
    expect(await cleanupApiArtifacts(client, now)).toEqual({ deleted: 0, days_scanned: 0, truncated: false });
    expect(removed).toEqual([]);
  });
});
