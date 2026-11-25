import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const createSignedUrls = vi.fn(async (paths: string[]) => ({
    data: paths.map((path) =>
      path.endsWith('/p2.jpg')
        ? { path, signedUrl: null, error: 'Either the bucket or the object does not exist' }
        : { path, signedUrl: `https://ref.supabase.co/storage/v1/object/sign/octree/${path}?token=t`, error: null }
    ),
    error: null,
  }));
  const storageFrom = vi.fn(() => ({ createSignedUrls }));
  const order = vi.fn(async () => ({ data: [{ id: 'p1' }, { id: 'p2' }] }));
  return { createSignedUrls, storageFrom, order };
});

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    from: () => ({ select: () => ({ order: mocks.order }) }),
    storage: { from: mocks.storageFrom },
  }),
}));

import { getAllProjects } from '@/actions/get-projects';

describe('getAllProjects thumbnails', () => {
  it('signs every thumbnail in one batch; projects without one get null', async () => {
    const rows = await getAllProjects();
    expect(mocks.storageFrom).toHaveBeenCalledWith('octree');
    expect(mocks.createSignedUrls).toHaveBeenCalledTimes(1);
    expect(mocks.createSignedUrls.mock.calls[0][0]).toEqual([
      'projects/_previews/p1.jpg',
      'projects/_previews/p2.jpg',
    ]);
    expect(rows![0].preview_url).toContain('/object/sign/octree/projects/_previews/p1.jpg');
    expect(rows![1].preview_url).toBeNull();
  });

  it('returns null without signing when the projects query fails', async () => {
    mocks.createSignedUrls.mockClear();
    mocks.order.mockResolvedValueOnce({ data: null } as any);
    expect(await getAllProjects()).toBeNull();
    expect(mocks.createSignedUrls).not.toHaveBeenCalled();
  });
});
