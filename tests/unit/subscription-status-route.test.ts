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
  const adminRpc = vi.fn(async () => ({ error: null }));
  const adminFrom = vi.fn(() => ({
    update: () => ({ eq: async () => ({ error: null }) }),
  }));
  const subscriptionsList = vi.fn();
  const resolveStripeCustomer = vi.fn();
  return { getUser, userSingle, userFrom, adminRpc, adminFrom, subscriptionsList, resolveStripeCustomer };
});

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { getUser: mocks.getUser }, from: mocks.userFrom }),
}));

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({ from: mocks.adminFrom, rpc: mocks.adminRpc }),
}));

vi.mock('@/lib/stripe', () => ({
  stripe: { subscriptions: { list: mocks.subscriptionsList } },
}));

vi.mock('@/lib/stripe-customer', () => ({
  resolveStripeCustomer: mocks.resolveStripeCustomer,
}));

import { GET } from '@/app/api/subscription-status/route';

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

  it('never calls the RPC without a Stripe subscription', async () => {
    mocks.subscriptionsList.mockResolvedValue({ data: [] });

    const res = await GET();
    const body = await res.json();

    expect(body.hasSubscription).toBe(false);
    expect(mocks.adminRpc).not.toHaveBeenCalled();
  });
});
