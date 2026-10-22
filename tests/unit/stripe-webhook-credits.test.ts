import { describe, it, expect, beforeEach, vi } from 'vitest';
import type Stripe from 'stripe';

import {
  creditsFromCheckoutSession,
  grantCreditsFromCheckoutSession,
  isOctreeCheckoutSession,
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

function makeSupabase(rpc: { data: any; error: any } = { data: 100, error: null }) {
  const rpcFn = vi.fn().mockResolvedValue(rpc);
  return { client: { rpc: rpcFn } as any, rpc: rpcFn };
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

  it('grants through one service-role RPC carrying the session id, credits, amount and currency', async () => {
    const { client, rpc } = makeSupabase();

    const result = await grantCreditsFromCheckoutSession(client, creditsSession());

    expect(result).toEqual({ granted: true, userId: 'user-1', credits: 100, balance: 100 });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith('grant_credit_purchase', {
      p_user_id: 'user-1',
      p_checkout_session_id: 'cs_credits_1',
      p_credits: 100,
      p_amount_cents: 500,
      p_currency: 'usd',
    });
  });

  it('is idempotent: a session already in the ledger (RPC returns NULL) grants nothing', async () => {
    const { client } = makeSupabase({ data: null, error: null });

    const result = await grantCreditsFromCheckoutSession(client, creditsSession());

    expect(result).toEqual({ granted: false, reason: 'duplicate' });
  });

  it('ignores sessions that are not a credit pack', async () => {
    const { client, rpc } = makeSupabase();

    const result = await grantCreditsFromCheckoutSession(client, creditsSession({ mode: 'subscription' }));

    expect(result).toEqual({ granted: false, reason: 'not_credits' });
    expect(rpc).not.toHaveBeenCalled();
  });

  it('throws on an RPC error so Stripe retries (nothing was written: ledger and balance share a transaction)', async () => {
    const { client } = makeSupabase({ data: null, error: { code: 'PGRST205', message: 'function missing' } });

    await expect(grantCreditsFromCheckoutSession(client, creditsSession())).rejects.toMatchObject({
      code: 'PGRST205',
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

describe('credit packs from another app on the shared Stripe account', () => {
  // filerenamerai.com shares the Stripe account; its sessions have the same
  // user_id + credits shape as an Octree pack but never `plan`. The route
  // drops them on isOctreeCheckoutSession before any grant.
  const foreign = creditsSession({ id: 'cs_foreign_1', metadata: { credits: '1000', user_id: 'not-an-octree-user' } });

  it('is not an Octree session even though its metadata looks like a credit pack', () => {
    expect(creditsFromCheckoutSession(foreign)).not.toBeNull();
    expect(isOctreeCheckoutSession(foreign)).toBe(false);
  });

  it('legacy (untagged) and tagged Octree credit packs are Octree sessions', () => {
    expect(isOctreeCheckoutSession(creditsSession())).toBe(true);
    expect(
      isOctreeCheckoutSession(creditsSession({ metadata: { app: 'octree', user_id: 'user-1', plan: 'credits_100', credits: '100' } }))
    ).toBe(true);
  });
});
