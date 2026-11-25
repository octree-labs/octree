// @vitest-environment node
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  approve: vi.fn(),
  deny: vi.fn(),
  getDetails: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
}));
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: {
      getUser: mocks.getUser,
      oauth: { approveAuthorization: mocks.approve, denyAuthorization: mocks.deny, getAuthorizationDetails: mocks.getDetails },
    },
  }),
}));

vi.mock('@/components/icons/octree-logo', () => ({ OctreeLogo: () => null, OctreeWordmark: () => null }));

import { decideOAuthConsent } from '@/actions/oauth-consent';
import OAuthConsentPage from '@/app/oauth/consent/page';

const ID = '8b3f0d2e-5d4c-4f7a-9a51-0c6c0f1b2a3d';

function form(fields: Record<string, string>) {
  const data = new FormData();
  for (const [k, v] of Object.entries(fields)) data.set(k, v);
  return data;
}

async function redirectOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    const message = (error as Error).message;
    if (message.startsWith('REDIRECT:')) return message.slice('REDIRECT:'.length);
    throw error;
  }
  throw new Error('expected a redirect');
}

describe('decideOAuthConsent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getUser.mockResolvedValue({ data: { user: { id: 'u1', email: 'a@example.com' } } });
  });

  it('approves for the signed-in user and redirects to the client', async () => {
    mocks.approve.mockResolvedValue({ data: { redirect_url: 'https://claude.ai/api/mcp/auth_callback?code=c' }, error: null });
    expect(await redirectOf(decideOAuthConsent(form({ authorization_id: ID, decision: 'approve' })))).toBe(
      'https://claude.ai/api/mcp/auth_callback?code=c'
    );
    expect(mocks.approve).toHaveBeenCalledWith(ID, { skipBrowserRedirect: true });
  });

  it('sends signed-out users to login, and rejects bad input', async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null } });
    expect(await redirectOf(decideOAuthConsent(form({ authorization_id: ID, decision: 'deny' })))).toMatch(/^\/auth\/login\?next=/);
    expect(mocks.deny).not.toHaveBeenCalled();
    expect(await redirectOf(decideOAuthConsent(form({ authorization_id: 'x', decision: 'approve' })))).toBe('/oauth/consent');
  });
});

describe('/oauth/consent page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('redirects signed-out visitors to login with the request preserved', async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null } });
    const url = await redirectOf(OAuthConsentPage({ searchParams: Promise.resolve({ authorization_id: ID }) }));
    expect(decodeURIComponent(url)).toBe(`/auth/login?next=/oauth/consent?authorization_id=${ID}`);
    expect(mocks.getDetails).not.toHaveBeenCalled();
  });

  it('redirects straight back when consent was already given', async () => {
    mocks.getUser.mockResolvedValue({ data: { user: { id: 'u1' } } });
    mocks.getDetails.mockResolvedValue({ data: { redirect_url: 'https://claude.ai/api/mcp/auth_callback?code=c' }, error: null });
    expect(await redirectOf(OAuthConsentPage({ searchParams: Promise.resolve({ authorization_id: ID }) }))).toBe(
      'https://claude.ai/api/mcp/auth_callback?code=c'
    );
  });

  it('renders the consent card for a pending request', async () => {
    mocks.getUser.mockResolvedValue({ data: { user: { id: 'u1', email: 'a@example.com' } } });
    mocks.getDetails.mockResolvedValue({
      data: { authorization_id: ID, scope: 'email', redirect_uri: 'http://localhost:3118/callback', client: { name: 'Claude Code' } },
      error: null,
    });
    const element = await OAuthConsentPage({ searchParams: Promise.resolve({ authorization_id: ID }) });
    const html = renderToStaticMarkup(element);
    expect(html).toContain('Claude Code');
    expect(html).toContain('localhost:3118');
    expect(html).toContain('a@example.com');
    expect(html).toContain('running on your computer');
    expect(html).toMatch(/value="approve"/);
    expect(html).toMatch(/value="deny"/);
  });
});
