import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  createSignedUrlMap,
  MAX_PATHS_PER_SIGN_REQUEST,
  SIGNED_URL_TTL_SECONDS,
  storagePathFromUrl,
} from '@/lib/storage/signed-urls';
import {
  attachmentStoragePath,
  signAttachmentPreviews,
} from '@/lib/generate/attachment-previews';

const BASE = 'https://ref.supabase.co/storage/v1/object';

/** A storage client whose createSignedUrls signs every path except `missing`. */
function fakeClient(missing: string[] = [], failBatch = false) {
  const createSignedUrls = vi.fn(async (paths: string[], expiresIn: number) => {
    if (failBatch) return { data: null, error: { message: 'boom' } };
    return {
      data: paths.map((path) =>
        missing.includes(path)
          ? { path, signedUrl: null, error: 'Either the bucket or the object does not exist' }
          : { path, signedUrl: `${BASE}/sign/bucket/${path}?token=t&ttl=${expiresIn}`, error: null }
      ),
      error: null,
    };
  });
  const from = vi.fn(() => ({ createSignedUrls }));
  return { client: { storage: { from } } as any, from, createSignedUrls };
}

describe('storagePathFromUrl', () => {
  it('reads the path out of a public URL', () => {
    expect(storagePathFromUrl(`${BASE}/public/chat-attachments/u1/d1/f1.png`, 'chat-attachments')).toBe(
      'u1/d1/f1.png'
    );
  });

  it('reads signed and authenticated URLs and drops the query', () => {
    expect(storagePathFromUrl(`${BASE}/sign/octree/projects/p/a.jpg?token=x`, 'octree')).toBe('projects/p/a.jpg');
    expect(storagePathFromUrl(`${BASE}/authenticated/octree/projects/p/a.jpg`, 'octree')).toBe('projects/p/a.jpg');
  });

  it('decodes percent-encoded segments', () => {
    expect(storagePathFromUrl(`${BASE}/public/chat-attachments/u1/my%20file.png`, 'chat-attachments')).toBe(
      'u1/my file.png'
    );
  });

  it('refuses another bucket, non-storage URLs and junk', () => {
    expect(storagePathFromUrl(`${BASE}/public/octree/projects/p/a.jpg`, 'chat-attachments')).toBeNull();
    expect(storagePathFromUrl('blob:https://app.useoctree.com/123', 'chat-attachments')).toBeNull();
    expect(storagePathFromUrl('data:image/png;base64,AAAA', 'chat-attachments')).toBeNull();
    expect(storagePathFromUrl('not a url', 'chat-attachments')).toBeNull();
    expect(storagePathFromUrl(`${BASE}/public/chat-attachments/`, 'chat-attachments')).toBeNull();
    expect(storagePathFromUrl(null, 'chat-attachments')).toBeNull();
    expect(storagePathFromUrl(`${BASE}/public/chat-attachments/%E0%A4%A`, 'chat-attachments')).toBeNull();
  });
});

describe('createSignedUrlMap', () => {
  it('signs unique paths in one request with the default TTL', async () => {
    const { client, from, createSignedUrls } = fakeClient();
    const map = await createSignedUrlMap(client, 'octree', ['a', 'b', 'a', '']);
    expect(from).toHaveBeenCalledWith('octree');
    expect(createSignedUrls).toHaveBeenCalledTimes(1);
    expect(createSignedUrls).toHaveBeenCalledWith(['a', 'b'], SIGNED_URL_TTL_SECONDS);
    expect([...map.keys()]).toEqual(['a', 'b']);
  });

  it('makes no request for an empty list', async () => {
    const { client, createSignedUrls } = fakeClient();
    expect((await createSignedUrlMap(client, 'octree', [])).size).toBe(0);
    expect(createSignedUrls).not.toHaveBeenCalled();
  });

  it('splits large lists into batches', async () => {
    const { client, createSignedUrls } = fakeClient();
    const paths = Array.from({ length: MAX_PATHS_PER_SIGN_REQUEST * 2 + 1 }, (_, i) => `p${i}`);
    const map = await createSignedUrlMap(client, 'octree', paths, 60);
    expect(createSignedUrls).toHaveBeenCalledTimes(3);
    expect(createSignedUrls.mock.calls.map(([batch]) => batch.length)).toEqual([
      MAX_PATHS_PER_SIGN_REQUEST,
      MAX_PATHS_PER_SIGN_REQUEST,
      1,
    ]);
    expect(map.size).toBe(paths.length);
  });

  it('leaves out missing objects and failed batches', async () => {
    const missing = fakeClient(['b']);
    expect([...(await createSignedUrlMap(missing.client, 'octree', ['a', 'b'])).keys()]).toEqual(['a']);

    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const failing = fakeClient([], true);
    expect((await createSignedUrlMap(failing.client, 'octree', ['a'])).size).toBe(0);
    error.mockRestore();
  });
});

describe('chat attachment previews', () => {
  const legacyUrl = `${BASE}/public/chat-attachments/u1/d1/old.png`;

  it('takes the stored path, else derives it from a legacy URL', () => {
    expect(attachmentStoragePath({ path: 'u1/d1/new.png', url: legacyUrl })).toBe('u1/d1/new.png');
    expect(attachmentStoragePath({ url: legacyUrl })).toBe('u1/d1/old.png');
    expect(attachmentStoragePath({ preview: legacyUrl })).toBe('u1/d1/old.png');
    expect(attachmentStoragePath({ preview: 'blob:https://x/1' })).toBeNull();
  });

  it('signs new and legacy image attachments in one request', async () => {
    const { client, createSignedUrls } = fakeClient(['u1/d1/gone.png']);
    const messages = [
      {
        id: 'm1',
        attachments: [
          { id: 'a', name: 'new.png', type: 'image' as const, preview: null, path: 'u1/d1/new.png' },
          { id: 'b', name: 'old.png', type: 'image' as const, preview: legacyUrl },
          { id: 'c', name: 'gone.png', type: 'image' as const, preview: null, path: 'u1/d1/gone.png' },
          { id: 'd', name: 'notes.pdf', type: 'document' as const, preview: null, path: 'u1/d1/notes.pdf' },
        ],
      },
      { id: 'm2' },
    ];

    const signed = await signAttachmentPreviews(client, messages);

    expect(createSignedUrls).toHaveBeenCalledTimes(1);
    expect(createSignedUrls.mock.calls[0][0]).toEqual(['u1/d1/new.png', 'u1/d1/old.png', 'u1/d1/gone.png']);
    const [a, b, c, d] = signed[0].attachments!;
    expect(a.preview).toContain('/sign/bucket/u1/d1/new.png');
    expect(b).toMatchObject({ path: 'u1/d1/old.png' });
    expect(b.preview).toContain('/sign/bucket/u1/d1/old.png');
    expect(c.preview).toBeNull();
    expect(d.preview).toBeNull();
    expect(signed[1]).toBe(messages[1]);
  });

  it('returns the messages untouched when nothing is stored', async () => {
    const { client, createSignedUrls } = fakeClient();
    const messages = [{ id: 'm', attachments: [{ type: 'image' as const, preview: 'blob:https://x/1' }] }];
    expect(await signAttachmentPreviews(client, messages)).toBe(messages);
    expect(createSignedUrls).not.toHaveBeenCalled();
  });
});

describe('private buckets migration', () => {
  const sql = readFileSync(
    join(__dirname, '../../supabase/migrations/20261126000000_private_storage_buckets.sql'),
    'utf8'
  )
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('--'))
    .join('\n')
    .trim();

  it('only flips the two app buckets to private', () => {
    expect(sql).toBe(
      "update storage.buckets\nset public = false\nwhere id in ('octree', 'chat-attachments')\n  and public;"
    );
  });
});
