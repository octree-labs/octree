import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * app/api/projects/[projectId]/files/[fileId] reads and writes a project
 * file in storage. It must confirm the project belongs to the signed-in user
 * before touching storage, so it does not depend on storage policies alone.
 */

const PROJECT_ID = '11111111-2222-4333-8444-555555555555';
const FILE_ID = 'file-1';

const mocks = vi.hoisted(() => {
  const getUser = vi.fn();
  const projectMaybeSingle = vi.fn();
  const projectEqUser = vi.fn(() => ({ maybeSingle: projectMaybeSingle }));
  const projectEqId = vi.fn(() => ({ eq: projectEqUser }));
  const projectSelect = vi.fn(() => ({ eq: projectEqId }));
  const projectUpdateEqUser = vi.fn().mockResolvedValue({ error: null });
  const projectUpdateEqId = vi.fn(() => ({ eq: projectUpdateEqUser }));
  const projectUpdate = vi.fn(() => ({ eq: projectUpdateEqId }));
  const from = vi.fn((table: string) => {
    if (table === 'projects') return { select: projectSelect, update: projectUpdate };
    throw new Error(`unexpected table ${table}`);
  });

  const list = vi.fn();
  const download = vi.fn();
  const upload = vi.fn();
  const storageFrom = vi.fn(() => ({ list, download, upload }));

  return {
    getUser,
    projectMaybeSingle,
    projectEqId,
    projectEqUser,
    from,
    list,
    download,
    upload,
    storageFrom,
  };
});

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: mocks.getUser },
    from: mocks.from,
    storage: { from: mocks.storageFrom },
  }),
}));

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { GET, PUT } from '@/app/api/projects/[projectId]/files/[fileId]/route';

const user = { id: 'user-1' };
const params = (projectId = PROJECT_ID, fileId = FILE_ID) => ({
  params: Promise.resolve({ projectId, fileId }),
});
const url = `https://app.useoctree.com/api/projects/${PROJECT_ID}/files/${FILE_ID}`;
const getRequest = () => new NextRequest(url);
const putRequest = (content = 'new') =>
  new NextRequest(url, { method: 'PUT', body: JSON.stringify({ content }) });

const storageFile = {
  id: FILE_ID,
  name: 'main.tex',
  metadata: { size: 3, mimetype: 'text/x-tex' },
  created_at: '2026-11-01T00:00:00Z',
  updated_at: '2026-11-01T00:00:00Z',
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getUser.mockResolvedValue({ data: { user } });
  mocks.projectMaybeSingle.mockResolvedValue({ data: { id: PROJECT_ID }, error: null });
  mocks.list.mockResolvedValue({ data: [storageFile], error: null });
  mocks.download.mockResolvedValue({ data: { text: async () => 'old' }, error: null });
  mocks.upload.mockResolvedValue({ error: null });
});

describe.each([
  ['GET', () => GET(getRequest(), params())],
  ['PUT', () => PUT(putRequest(), params())],
])('%s /api/projects/[projectId]/files/[fileId]', (_method, call) => {
  it('returns 401 without a user and never touches storage', async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null } });

    const res = await call();

    expect(res.status).toBe(401);
    expect(mocks.storageFrom).not.toHaveBeenCalled();
  });

  it("returns 404 for a project the user does not own and never touches storage", async () => {
    mocks.projectMaybeSingle.mockResolvedValue({ data: null, error: null });

    const res = await call();

    expect(res.status).toBe(404);
    expect(mocks.projectEqId).toHaveBeenCalledWith('id', PROJECT_ID);
    expect(mocks.projectEqUser).toHaveBeenCalledWith('user_id', user.id);
    expect(mocks.storageFrom).not.toHaveBeenCalled();
  });

  it('returns 404 when the ownership query errors', async () => {
    mocks.projectMaybeSingle.mockResolvedValue({ data: null, error: { message: 'boom' } });

    const res = await call();

    expect(res.status).toBe(404);
    expect(mocks.storageFrom).not.toHaveBeenCalled();
  });
});

describe('project id validation', () => {
  it('rejects a project id that is not a uuid before querying anything', async () => {
    const res = await GET(getRequest(), params('../other-project'));

    expect(res.status).toBe(404);
    expect(mocks.from).not.toHaveBeenCalled();
    expect(mocks.storageFrom).not.toHaveBeenCalled();
  });
});

describe('owned project', () => {
  it('GET lists only the project folder and returns the file', async () => {
    const res = await GET(getRequest(), params());

    expect(res.status).toBe(200);
    expect(mocks.list).toHaveBeenCalledWith(`projects/${PROJECT_ID}`);
    expect(mocks.download).toHaveBeenCalledWith(`projects/${PROJECT_ID}/main.tex`);
    const body = await res.json();
    expect(body.document.content).toBe('old');
  });

  it('GET returns 404 for a file id that is not in the project folder', async () => {
    const res = await GET(getRequest(), params(PROJECT_ID, 'someone-elses-file'));

    expect(res.status).toBe(404);
    expect(mocks.download).not.toHaveBeenCalled();
  });

  it('PUT writes the file inside the project folder', async () => {
    const res = await PUT(putRequest('updated'), params());

    expect(res.status).toBe(200);
    expect(mocks.upload).toHaveBeenCalledWith(
      `projects/${PROJECT_ID}/main.tex`,
      expect.any(Blob),
      expect.objectContaining({ upsert: true })
    );
  });
});
