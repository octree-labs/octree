import { describe, it, expect, beforeEach, vi } from 'vitest';
import type Stripe from 'stripe';

import {
  creditsFromCheckoutSession,
  grantCreditsFromCheckoutSession,
  planFromPrice,
} from '@/lib/stripe-webhook';
import { STRIPE_PRICE_IDS } from '@/lib/stripe-config';

vi.mock('@/lib/reddit-capi', () => ({
  trackRedditConversion: vi.fn().mockResolvedValue(undefined),
}));

function creditsSession(overrides: Record<string, unknown> = {}) {
  return {
    id: 'cs_credits_1',
    mode: 'payment',
    payment_status: 'paid',
    amount_total: 500,
    currency: 'usd',
    metadata: { user_id: 'user-1', plan: 'credits_100', credits: '100' },
    ...overrides,
  } as unknown as Stripe.Checkout.Session;
}

function makeSupabase(ledger: { error: any } = { error: null }, rpc: { data: any; error: any } = { data: 100, error: null }) {
  const insert = vi.fn().mockResolvedValue(ledger);
  const from = vi.fn().mockReturnValue({ insert });
  const rpcFn = vi.fn().mockResolvedValue(rpc);
  return { client: { from, rpc: rpcFn } as any, insert, from, rpc: rpcFn };
}

describe('creditsFromCheckoutSession', () => {
  it('reads the buyer and credit count from a paid payment-mode session', () => {
    expect(creditsFromCheckoutSession(creditsSession())).toEqual({ userId: 'user-1', credits: 100 });
  });

  it.each([
    ['a subscription session', { mode: 'subscription' }],
    ['an unpaid session', { payment_status: 'unpaid' }],
    ['no metadata', { metadata: null }],
    ['no credits in metadata', { metadata: { user_id: 'user-1' } }],
    ['a non-numeric credit count', { metadata: { user_id: 'user-1', credits: 'lots' } }],
    ['a zero credit count', { metadata: { user_id: 'user-1', credits: '0' } }],
    ['no user id', { metadata: { credits: '100' } }],
  ])('returns null for %s', (_label, overrides) => {
    expect(creditsFromCheckoutSession(creditsSession(overrides))).toBeNull();
  });
});

describe('grantCreditsFromCheckoutSession', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('writes one ledger row then bumps the balance through the service-role RPC', async () => {
    const { client, from, insert, rpc } = makeSupabase();

    const result = await grantCreditsFromCheckoutSession(client, creditsSession());

    expect(result).toEqual({ granted: true, userId: 'user-1', credits: 100, balance: 100 });
    expect(from).toHaveBeenCalledWith('credit_purchases');
    expect(insert).toHaveBeenCalledWith({
      user_id: 'user-1',
      checkout_session_id: 'cs_credits_1',
      credits: 100,
      amount_cents: 500,
      currency: 'usd',
    });
    expect(rpc).toHaveBeenCalledWith('add_edit_credits', { p_user_id: 'user-1', p_credits: 100 });
  });

  it('is idempotent: a session already in the ledger grants nothing', async () => {
    const { client, rpc } = makeSupabase({ error: { code: '23505', message: 'duplicate key' } });

    const result = await grantCreditsFromCheckoutSession(client, creditsSession());

    expect(result).toEqual({ granted: false, reason: 'duplicate' });
    expect(rpc).not.toHaveBeenCalled();
  });

  it('ignores sessions that are not a credit pack', async () => {
    const { client, insert } = makeSupabase();

    const result = await grantCreditsFromCheckoutSession(client, creditsSession({ mode: 'subscription' }));

    expect(result).toEqual({ granted: false, reason: 'not_credits' });
    expect(insert).not.toHaveBeenCalled();
  });

  it('throws on any other ledger error so Stripe retries', async () => {
    const { client, rpc } = makeSupabase({ error: { code: 'PGRST205', message: 'table missing' } });

    await expect(grantCreditsFromCheckoutSession(client, creditsSession())).rejects.toMatchObject({
      code: 'PGRST205',
    });
    expect(rpc).not.toHaveBeenCalled();
  });

  it('throws when the balance RPC fails (the ledger row then blocks a silent retry, by design)', async () => {
    const { client } = makeSupabase({ error: null }, { data: null, error: { message: 'boom' } });

    await expect(grantCreditsFromCheckoutSession(client, creditsSession())).rejects.toMatchObject({
      message: 'boom',
    });
  });
});

describe('planFromPrice', () => {
  it('recognises the new prices by lookup key', () => {
    expect(planFromPrice({ id: 'price_x', lookup_key: 'octree_pro_annual' })).toBe('annual');
    expect(planFromPrice({ id: 'price_x', lookup_key: 'octree_semester_pass' })).toBe('semester');
    expect(planFromPrice({ id: 'price_x', lookup_key: 'octree_pro_monthly' })).toBe('monthly');
  });

  it('falls back to the price metadata when the lookup key was transferred away', () => {
    expect(planFromPrice({ id: 'price_x', lookup_key: null, metadata: { octree_plan: 'octree_pro_annual' } })).toBe(
      'annual'
    );
  });

  it('still maps the two pre-existing prices by id', () => {
    expect(planFromPrice({ id: STRIPE_PRICE_IDS.proAnnual })).toBe('monthly');
    expect(planFromPrice({ id: STRIPE_PRICE_IDS.pro })).toBe('weekly');
  });

  it('does not treat the credit pack as a subscription plan', () => {
    expect(planFromPrice({ id: 'price_x', lookup_key: 'octree_credits_100' })).toBe('unknown');
    expect(planFromPrice(null)).toBe('unknown');
  });
});
