import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * GET /api/subscription-status runs on every page load (usage indicator,
 * billing page, generate preview). It used to call
 * update_user_subscription_status on each of those loads, and that RPC
 * zeroed monthly_edit_count whenever the subscription was active, so no Pro
 * user ever accumulated a monthly count. These tests pin the route's side of
 * the fix: the RPC is skipped when the row already matches Stripe, and still
 * called when something changed.
 */

const mocks = vi.hoisted(() => {
  const getUser = vi.fn();
  const userSingle = vi.fn();
  const userFrom = vi.fn(() => ({
    select: () => ({ eq: () => ({ single: userSingle }) }),
  }));
  const adminRpc = vi.fn(async (): Promise<{ error: { message: string } | null }> => ({ error: null }));
  const adminFrom = vi.fn(() => ({
    update: () => ({ eq: async () => ({ error: null }) }),
  }));
  const subscriptionsList = vi.fn();
  const subscriptionsRetrieve = vi.fn();
  const resolveStripeCustomer = vi.fn();
  const captureServerEventAfterResponse = vi.fn();
  return {
    getUser,
    userSingle,
    userFrom,
    adminRpc,
    adminFrom,
    subscriptionsList,
    subscriptionsRetrieve,
    resolveStripeCustomer,
    captureServerEventAfterResponse,
  };
});

vi.mock('@/lib/posthog-server', () => ({
  captureServerEventAfterResponse: mocks.captureServerEventAfterResponse,
  captureServerExceptionAfterResponse: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { getUser: mocks.getUser }, from: mocks.userFrom }),
}));

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({ from: mocks.adminFrom, rpc: mocks.adminRpc }),
}));

vi.mock('@/lib/stripe', () => ({
  stripe: { subscriptions: { list: mocks.subscriptionsList, retrieve: mocks.subscriptionsRetrieve } },
}));

vi.mock('@/lib/stripe-customer', () => ({
  resolveStripeCustomer: mocks.resolveStripeCustomer,
}));

import { GET } from '@/app/api/subscription-status/route';
import { entitlementFromStatusResponse } from '@/lib/subscription/entitlement';
import { unlimitedEditEmails } from '@/lib/paywall';

const user = { id: 'user-1', email: 'pro@example.com' };
const periodStart = 1_760_000_000;
const periodEnd = periodStart + 30 * 24 * 60 * 60;

function stripeSubscription(overrides: Record<string, unknown> = {}) {
  return {
    id: 'sub_1',
    status: 'active',
    cancel_at_period_end: false,
    current_period_start: periodStart,
    current_period_end: periodEnd,
    items: { data: [] },
    metadata: {},
    ...overrides,
  };
}

function usageRow(overrides: Record<string, unknown> = {}) {
  return {
    user_id: 'user-1',
    edit_count: 0,
    monthly_edit_count: 42,
    is_pro: true,
    subscription_status: 'active',
    stripe_customer_id: 'cus_1',
    stripe_subscription_id: 'sub_1',
    current_period_start: new Date(periodStart * 1000).toISOString().replace('.000Z', '+00:00'),
    current_period_end: new Date(periodEnd * 1000).toISOString().replace('.000Z', '+00:00'),
    cancel_at_period_end: false,
    monthly_reset_date: '2099-01-01',
    daily_reset_date: '2099-01-01',
    ...overrides,
  };
}

describe('GET /api/subscription-status: when the subscription RPC runs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getUser.mockResolvedValue({ data: { user }, error: null });
    mocks.userSingle.mockResolvedValue({ data: usageRow(), error: null });
    mocks.resolveStripeCustomer.mockResolvedValue({ customerId: 'cus_1' });
    mocks.subscriptionsList.mockResolvedValue({ data: [stripeSubscription()] });
    mocks.adminRpc.mockResolvedValue({ error: null });
  });

  it('does not call update_user_subscription_status when the row already matches Stripe', async () => {
    const res = await GET();

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.hasSubscription).toBe(true);
    expect(body.usage.monthlyEditCount).toBe(42);
    expect(body.usage.remainingMonthlyEdits).toBe(500 - 42);
    expect(mocks.adminRpc).not.toHaveBeenCalled();
  });

  it('calls the RPC when Stripe reports a new billing period', async () => {
    const newStart = periodEnd;
    mocks.subscriptionsList.mockResolvedValue({
      data: [stripeSubscription({ current_period_start: newStart, current_period_end: newStart + 30 * 24 * 60 * 60 })],
    });

    await GET();

    expect(mocks.adminRpc).toHaveBeenCalledTimes(1);
    expect(mocks.adminRpc).toHaveBeenCalledWith(
      'update_user_subscription_status',
      expect.objectContaining({
        p_user_id: 'user-1',
        p_stripe_subscription_id: 'sub_1',
        p_subscription_status: 'active',
        p_current_period_start: new Date(newStart * 1000).toISOString(),
      })
    );
  });

  it('calls the RPC when cancel_at_period_end changed', async () => {
    mocks.subscriptionsList.mockResolvedValue({ data: [stripeSubscription({ cancel_at_period_end: true })] });

    await GET();

    expect(mocks.adminRpc).toHaveBeenCalledWith(
      'update_user_subscription_status',
      expect.objectContaining({ p_cancel_at_period_end: true })
    );
  });

  it('calls the RPC with `paused` when collection is paused past the paid period', async () => {
    mocks.subscriptionsList.mockResolvedValue({
      data: [stripeSubscription({ pause_collection: { behavior: 'void', resumes_at: periodEnd } })],
    });

    const res = await GET();
    const body = await res.json();

    expect(mocks.adminRpc).toHaveBeenCalledWith(
      'update_user_subscription_status',
      expect.objectContaining({ p_subscription_status: 'paused' })
    );
    expect(body.subscription.effective_status).toBe('paused');
    expect(body.usage.isPro).toBe(false);
  });

  it('calls the RPC for a row that has never seen this subscription', async () => {
    mocks.userSingle.mockResolvedValue({
      data: usageRow({ is_pro: false, subscription_status: 'inactive', stripe_subscription_id: null, current_period_start: null, current_period_end: null }),
      error: null,
    });

    await GET();

    expect(mocks.adminRpc).toHaveBeenCalledTimes(1);
  });

  it('never calls the RPC for a free row without a Stripe subscription', async () => {
    mocks.userSingle.mockResolvedValue({
      data: usageRow({ is_pro: false, subscription_status: 'inactive', stripe_subscription_id: null, current_period_start: null, current_period_end: null }),
      error: null,
    });
    mocks.subscriptionsList.mockResolvedValue({ data: [] });

    const res = await GET();
    const body = await res.json();

    expect(body.hasSubscription).toBe(false);
    expect(body.usage.isPro).toBe(false);
    expect(mocks.adminRpc).not.toHaveBeenCalled();
    expect(mocks.subscriptionsRetrieve).not.toHaveBeenCalled();
  });
});

/**
 * Self-heal for stale rows: `is_pro = true` for a subscription Stripe has
 * ended. The row's claim no longer grants Pro, and the row is rewritten to
 * the free tier through the same RPC the webhook path uses.
 */
describe('GET /api/subscription-status: stale is_pro rows', () => {
  const canceledPeriodEnd = periodStart - 24 * 60 * 60;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getUser.mockResolvedValue({ data: { user }, error: null });
    mocks.resolveStripeCustomer.mockResolvedValue({ customerId: 'cus_1' });
    mocks.subscriptionsList.mockResolvedValue({ data: [] });
    mocks.adminRpc.mockResolvedValue({ error: null });
    mocks.userSingle.mockResolvedValue({
      data: usageRow({
        is_pro: true,
        subscription_status: 'active',
        current_period_end: new Date(canceledPeriodEnd * 1000).toISOString(),
      }),
      error: null,
    });
  });

  it('revokes Pro and rewrites the row when Stripe reports the stored subscription canceled', async () => {
    mocks.subscriptionsRetrieve.mockResolvedValue(
      stripeSubscription({ status: 'canceled', current_period_end: canceledPeriodEnd })
    );

    const res = await GET();
    const body = await res.json();

    expect(mocks.subscriptionsRetrieve).toHaveBeenCalledWith('sub_1');
    expect(body.hasSubscription).toBe(false);
    expect(body.usage.isPro).toBe(false);
    expect(body.usage.stripeStatus).toBe('canceled');
    // What the webhook's customer.subscription.deleted would have written.
    expect(body.usage.subscriptionStatus).toBe('canceled');
    expect(mocks.adminRpc).toHaveBeenCalledTimes(1);
    expect(mocks.adminRpc).toHaveBeenCalledWith(
      'update_user_subscription_status',
      expect.objectContaining({
        p_user_id: 'user-1',
        p_stripe_customer_id: 'cus_1',
        p_stripe_subscription_id: 'sub_1',
        p_subscription_status: 'canceled',
        p_current_period_end: new Date(canceledPeriodEnd * 1000).toISOString(),
      })
    );
    expect(mocks.captureServerEventAfterResponse).toHaveBeenCalledWith(
      'user-1',
      'pro_entitlement_revoked',
      { reason: 'canceled', previous_status: 'active' }
    );
  });

  it('revokes when the stored subscription no longer exists in Stripe (404)', async () => {
    mocks.subscriptionsRetrieve.mockRejectedValue(
      Object.assign(new Error('No such subscription'), { code: 'resource_missing', statusCode: 404 })
    );

    const res = await GET();
    const body = await res.json();

    expect(body.usage.isPro).toBe(false);
    expect(body.usage.stripeStatus).toBe('missing');
    expect(mocks.adminRpc).toHaveBeenCalledWith(
      'update_user_subscription_status',
      expect.objectContaining({ p_subscription_status: 'canceled' })
    );
    expect(mocks.captureServerEventAfterResponse).toHaveBeenCalledWith(
      'user-1',
      'pro_entitlement_revoked',
      expect.objectContaining({ reason: 'missing' })
    );
  });

  it('does not grant Pro from is_pro alone even when the RPC write fails', async () => {
    mocks.subscriptionsRetrieve.mockResolvedValue(stripeSubscription({ status: 'canceled' }));
    mocks.adminRpc.mockResolvedValue({ error: { message: 'boom' } });

    const res = await GET();
    const body = await res.json();

    expect(body.usage.isPro).toBe(false);
  });

  it('keeps Pro and writes nothing when the stored subscription is still active in Stripe', async () => {
    mocks.subscriptionsRetrieve.mockResolvedValue(stripeSubscription({ status: 'active' }));

    const res = await GET();
    const body = await res.json();

    expect(body.usage.isPro).toBe(true);
    expect(body.usage.proSource).toBe('stripe');
    // The client re-derives from these fields; it must reach the same answer.
    expect(body.usage.stripeStatus).toBe('active');
    expect(entitlementFromStatusResponse(body).isPro).toBe(true);
    expect(mocks.adminRpc).not.toHaveBeenCalled();
    expect(mocks.captureServerEventAfterResponse).not.toHaveBeenCalled();
  });

  it('writes incomplete_expired as the webhook would', async () => {
    mocks.subscriptionsRetrieve.mockResolvedValue(stripeSubscription({ status: 'incomplete_expired' }));

    const res = await GET();
    const body = await res.json();

    expect(body.usage.isPro).toBe(false);
    expect(mocks.adminRpc).toHaveBeenCalledWith(
      'update_user_subscription_status',
      expect.objectContaining({ p_subscription_status: 'incomplete_expired' })
    );
  });

  it('does not rewrite the row for a status the webhook owns (past_due), and does not grant Pro', async () => {
    mocks.subscriptionsRetrieve.mockResolvedValue(stripeSubscription({ status: 'past_due' }));

    const res = await GET();
    const body = await res.json();

    expect(body.usage.isPro).toBe(false);
    expect(mocks.adminRpc).not.toHaveBeenCalled();
  });

  it('falls back to the row rule when Stripe is unreachable: period ended, so not Pro, nothing written', async () => {
    mocks.subscriptionsRetrieve.mockRejectedValue(new Error('network'));

    const res = await GET();
    const body = await res.json();

    expect(body.usage.isPro).toBe(false);
    expect(body.usage.stripeStatus).toBeNull();
    expect(mocks.adminRpc).not.toHaveBeenCalled();
    expect(mocks.captureServerEventAfterResponse).not.toHaveBeenCalled();
  });

  it('keeps Pro for an active row with a subscription id but no period end when Stripe is unreachable (never revokes)', async () => {
    // Several live subscribers' rows predate the period columns. A Stripe
    // outage must not read as "period ended" for them.
    mocks.resolveStripeCustomer.mockRejectedValue(new Error('network'));
    mocks.userSingle.mockResolvedValue({
      data: usageRow({ current_period_start: null, current_period_end: null }),
      error: null,
    });
    mocks.subscriptionsRetrieve.mockRejectedValue(new Error('network'));

    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.usage.isPro).toBe(true);
    expect(body.usage.proSource).toBe('row');
    expect(entitlementFromStatusResponse(body).isPro).toBe(true);
    expect(mocks.adminRpc).not.toHaveBeenCalled();
    expect(mocks.captureServerEventAfterResponse).not.toHaveBeenCalled();
  });

  it('does not revoke on a Stripe error that is not a 404 (401/403/5xx)', async () => {
    for (const statusCode of [401, 403, 500, 503]) {
      vi.clearAllMocks();
      mocks.getUser.mockResolvedValue({ data: { user }, error: null });
      mocks.resolveStripeCustomer.mockResolvedValue({ customerId: 'cus_1' });
      mocks.subscriptionsList.mockResolvedValue({ data: [] });
      // Row inside its paid period: the row rule keeps Pro while Stripe is unavailable.
      const futureEnd = Math.floor(Date.now() / 1000) + 10 * 24 * 60 * 60;
      mocks.userSingle.mockResolvedValue({
        data: usageRow({ current_period_end: new Date(futureEnd * 1000).toISOString() }),
        error: null,
      });
      mocks.subscriptionsRetrieve.mockRejectedValue(Object.assign(new Error('stripe'), { statusCode }));

      const res = await GET();
      const body = await res.json();

      expect(body.usage.isPro).toBe(true);
      expect(mocks.adminRpc).not.toHaveBeenCalled();
      expect(mocks.captureServerEventAfterResponse).not.toHaveBeenCalled();
    }
  });

  it('does not ask Stripe again once the row has been rewritten (no flapping)', async () => {
    mocks.userSingle.mockResolvedValue({
      data: usageRow({ is_pro: false, subscription_status: 'canceled' }),
      error: null,
    });

    const res = await GET();
    const body = await res.json();

    expect(body.usage.isPro).toBe(false);
    expect(mocks.subscriptionsRetrieve).not.toHaveBeenCalled();
    expect(mocks.adminRpc).not.toHaveBeenCalled();
  });

  it('keeps Pro from the row inside a paid period that the webhook has not synced yet', async () => {
    const futureEnd = Math.floor(Date.now() / 1000) + 10 * 24 * 60 * 60;
    mocks.userSingle.mockResolvedValue({
      data: usageRow({ current_period_end: new Date(futureEnd * 1000).toISOString() }),
      error: null,
    });
    mocks.subscriptionsRetrieve.mockRejectedValue(new Error('network'));

    const res = await GET();
    const body = await res.json();

    expect(body.usage.isPro).toBe(true);
    expect(body.usage.proSource).toBe('row');
    expect(mocks.adminRpc).not.toHaveBeenCalled();
  });

  it('never grants Pro to is_pro = true with no subscription id, and never asks Stripe for it', async () => {
    mocks.userSingle.mockResolvedValue({
      data: usageRow({ is_pro: true, subscription_status: 'active', stripe_subscription_id: null }),
      error: null,
    });

    const res = await GET();
    const body = await res.json();

    expect(body.usage.isPro).toBe(false);
    expect(mocks.subscriptionsRetrieve).not.toHaveBeenCalled();
    expect(mocks.adminRpc).not.toHaveBeenCalled();
  });

  it('keeps the unlimited grant without consulting Stripe', async () => {
    mocks.userSingle.mockResolvedValue({
      data: usageRow({ subscription_status: 'unlimited', stripe_subscription_id: 'sub_old' }),
      error: null,
    });

    const res = await GET();
    const body = await res.json();

    expect(body.usage.isPro).toBe(true);
    expect(body.usage.proSource).toBe('unlimited');
    expect(mocks.subscriptionsRetrieve).not.toHaveBeenCalled();
  });

  it('checks the stored subscription even when no Stripe customer resolves', async () => {
    mocks.resolveStripeCustomer.mockResolvedValue(null);
    mocks.subscriptionsRetrieve.mockResolvedValue(stripeSubscription({ status: 'canceled' }));

    const res = await GET();
    const body = await res.json();

    expect(body.usage.isPro).toBe(false);
    expect(mocks.adminRpc).toHaveBeenCalledWith(
      'update_user_subscription_status',
      expect.objectContaining({ p_subscription_status: 'canceled', p_stripe_customer_id: 'cus_1' })
    );
  });
});

describe('GET /api/subscription-status: first_purchase_offer', () => {
  const ledgerRows: Record<string, unknown[]> = {};

  function freeRow(overrides: Record<string, unknown> = {}) {
    return usageRow({
      is_pro: false,
      subscription_status: 'inactive',
      stripe_customer_id: null,
      stripe_subscription_id: null,
      current_period_start: null,
      current_period_end: null,
      edit_credits: 0,
      generation_credits: 0,
      free_generations_used: 1,
      ...overrides,
    });
  }

  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    ledgerRows.credit_purchases = [];
    ledgerRows.generation_purchases = [];
    mocks.getUser.mockResolvedValue({ data: { user: { id: 'user-1', email: 'new@example.com' } }, error: null });
    mocks.userSingle.mockResolvedValue({ data: freeRow(), error: null });
    mocks.resolveStripeCustomer.mockResolvedValue(null);
    mocks.adminFrom.mockImplementation(((table: string) => ({
      update: () => ({ eq: async () => ({ error: null }) }),
      select: () => ({ eq: () => ({ limit: async () => ({ data: ledgerRows[table] ?? [], error: null }) }) }),
    })) as any);
  });

  it('is welcome50 for a free user who never bought anything', async () => {
    const body = await (await GET()).json();
    expect(body.hasSubscription).toBe(false);
    expect(body.first_purchase_offer).toBe('welcome50');
    expect(mocks.adminFrom).toHaveBeenCalledWith('credit_purchases');
    expect(mocks.adminFrom).toHaveBeenCalledWith('generation_purchases');
  });

  it('is null once a one-off purchase is on record', async () => {
    ledgerRows.generation_purchases = [{ id: 'g1' }];
    const body = await (await GET()).json();
    expect(body.first_purchase_offer).toBeNull();
  });

  it('never asks Stripe for eligibility: a Stripe customer without a subscription still gets the offer', async () => {
    // Rare (a returning customer whose row kept no trace of the purchase):
    // checkout-session retries without the code when Stripe refuses it.
    mocks.resolveStripeCustomer.mockResolvedValue({ customerId: 'cus_email' });
    mocks.subscriptionsList.mockResolvedValue({ data: [] });
    const body = await (await GET()).json();
    expect(body.first_purchase_offer).toBe('welcome50');
  });

  it('a failing Stripe customer lookup does not change the offer', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.resolveStripeCustomer.mockRejectedValue(new Error('stripe down'));
    const body = await (await GET()).json();
    expect(body.first_purchase_offer).toBe('welcome50');
  });

  it('query budget for a never-paid user: 1 session read, the 2 ledger reads, no Stripe call beyond the customer lookup main already made', async () => {
    const body = await (await GET()).json();
    expect(body.first_purchase_offer).toBe('welcome50');
    // Route's own user_usage read (resolveStripeCustomer, mocked here, adds
    // its stripe_customer_id read and one customers.list, as on main).
    expect(mocks.userFrom).toHaveBeenCalledTimes(1);
    expect(mocks.adminFrom.mock.calls.map((c: unknown[]) => c[0])).toEqual(['credit_purchases', 'generation_purchases']);
    expect(mocks.resolveStripeCustomer).toHaveBeenCalledTimes(1);
    expect(mocks.subscriptionsList).not.toHaveBeenCalled();
    expect(mocks.subscriptionsRetrieve).not.toHaveBeenCalled();
  });

  it.each<[string, Record<string, unknown>]>([
    ['is_pro set with no subscription (flag-only grant)', { is_pro: true }],
    ['past_due with a stored subscription id', { subscription_status: 'past_due', stripe_subscription_id: 'sub_old' }],
    ['paused with a stored subscription id', { subscription_status: 'paused', stripe_subscription_id: 'sub_old' }],
    ['canceled with a stored subscription id', { subscription_status: 'canceled', stripe_subscription_id: 'sub_old' }],
    ['a stored customer id', { stripe_customer_id: 'cus_old' }],
    ['generation credits left', { generation_credits: 1 }],
  ])('is null with %s, and skips the ledgers', async (_name, overrides) => {
    mocks.userSingle.mockResolvedValue({ data: freeRow(overrides), error: null });
    mocks.subscriptionsRetrieve.mockResolvedValue({ id: 'sub_old', status: 'canceled', items: { data: [] } });
    const body = await (await GET()).json();
    expect(body.first_purchase_offer).toBeNull();
    expect(mocks.adminFrom).not.toHaveBeenCalledWith('credit_purchases');
    expect(mocks.adminFrom).not.toHaveBeenCalledWith('generation_purchases');
  });

  it('is null for staff on the allowlist', async () => {
    mocks.getUser.mockResolvedValue({ data: { user: { id: 'user-1', email: unlimitedEditEmails[0] } }, error: null });
    mocks.userSingle.mockResolvedValue({ data: freeRow({ is_pro: true, subscription_status: 'unlimited' }), error: null });
    const body = await (await GET()).json();
    expect(body.first_purchase_offer).toBeNull();
  });

  it('is null after a credit pack was bought and spent', async () => {
    ledgerRows.credit_purchases = [{ id: 'c1' }];
    const body = await (await GET()).json();
    expect(body.first_purchase_offer).toBeNull();
  });

  it('is null with edit credits left', async () => {
    mocks.userSingle.mockResolvedValue({ data: freeRow({ edit_credits: 40 }), error: null });
    const body = await (await GET()).json();
    expect(body.first_purchase_offer).toBeNull();
  });

  it('is null for a Pro subscriber', async () => {
    mocks.userSingle.mockResolvedValue({ data: usageRow(), error: null });
    mocks.resolveStripeCustomer.mockResolvedValue({ customerId: 'cus_1' });
    mocks.subscriptionsList.mockResolvedValue({ data: [stripeSubscription()] });
    const body = await (await GET()).json();
    expect(body.hasSubscription).toBe(true);
    expect(body.first_purchase_offer).toBeNull();
  });

  it.each(['LIFECYCLE_WARM_LEAD_OFFER_ENABLED', 'FIRST_PURCHASE_OFFER_ENABLED'])(
    'is null with %s=false',
    async (name) => {
      vi.stubEnv(name, 'false');
      const body = await (await GET()).json();
      expect(body.first_purchase_offer).toBeNull();
      expect(mocks.adminFrom).not.toHaveBeenCalledWith('credit_purchases');
      vi.unstubAllEnvs();
    }
  );
});
