import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * app/buy/page.tsx: the server render decides the auto offer. An explicit
 * `?offer=` skips the lookup; a signed-out (or lapsed) session and any
 * failure render the page without an offer; the lookup asks no Stripe API.
 */

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  createClient: vi.fn(),
  createAdminClient: vi.fn(),
  usageRow: vi.fn(),
  sessionFrom: vi.fn(),
  adminFrom: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({ createClient: mocks.createClient }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: mocks.createAdminClient }));
vi.mock('@/lib/stripe', () => ({
  stripe: new Proxy({}, { get: () => { throw new Error('/buy must not call Stripe'); } }),
}));
vi.mock('@/app/buy/buy-page-client', () => ({ BuyPageClient: () => null }));

import BuyPage from '@/app/buy/page';

function freeRow() {
  return {
    is_pro: false,
    subscription_status: 'inactive',
    stripe_customer_id: null,
    stripe_subscription_id: null,
    current_period_end: null,
    edit_credits: 0,
    generation_credits: 0,
  };
}

async function renderProps(params: Record<string, string> = {}) {
  const element = (await BuyPage({ searchParams: Promise.resolve(params) })) as any;
  return element.props as { plan: unknown; offer: unknown; autoOffer: unknown };
}

describe('/buy server render', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.usageRow.mockResolvedValue({ data: freeRow(), error: null });
    mocks.sessionFrom.mockImplementation(() => ({
      select: () => ({ eq: () => ({ maybeSingle: mocks.usageRow }) }),
    }));
    mocks.adminFrom.mockImplementation(() => ({
      select: () => ({ eq: () => ({ limit: async () => ({ data: [], error: null }) }) }),
    }));
    mocks.createClient.mockResolvedValue({ auth: { getUser: mocks.getUser }, from: mocks.sessionFrom });
    mocks.createAdminClient.mockReturnValue({ from: mocks.adminFrom });
    mocks.getUser.mockResolvedValue({ data: { user: { id: 'u1', email: 'new@example.com' } }, error: null });
  });

  it('auto-offers to a never-paid user: auth, one user_usage read, two ledger reads', async () => {
    expect(await renderProps()).toEqual({ plan: null, offer: null, autoOffer: 'welcome50' });
    expect(mocks.getUser).toHaveBeenCalledTimes(1);
    expect(mocks.sessionFrom).toHaveBeenCalledTimes(1);
    expect(mocks.adminFrom).toHaveBeenCalledTimes(2);
  });

  it('an explicit ?offer= skips the lookup entirely', async () => {
    expect(await renderProps({ offer: 'welcome50' })).toEqual({ plan: null, offer: 'welcome50', autoOffer: null });
    expect(mocks.createClient).not.toHaveBeenCalled();
  });

  it('renders without an offer for a signed-out session', async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: { message: 'no session' } });
    expect(await renderProps()).toEqual({ plan: null, offer: null, autoOffer: null });
    expect(mocks.sessionFrom).not.toHaveBeenCalled();
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });

  it('never throws: a failing client or admin client is no offer', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.createClient.mockRejectedValueOnce(new Error('cookies unavailable'));
    expect((await renderProps()).autoOffer).toBeNull();

    mocks.createAdminClient.mockImplementationOnce(() => {
      throw new Error('no service role key');
    });
    expect((await renderProps()).autoOffer).toBeNull();
  });

  it('no auto offer for a user with credits; the ledgers and admin client are not touched', async () => {
    mocks.usageRow.mockResolvedValue({ data: { ...freeRow(), edit_credits: 10 }, error: null });
    expect((await renderProps({ plan: 'monthly' }))).toEqual({ plan: 'monthly', offer: null, autoOffer: null });
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });
});
