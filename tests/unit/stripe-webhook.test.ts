import { describe, it, expect, beforeEach, vi } from 'vitest';
import type Stripe from 'stripe';

import {
  generationCreditsFromSession,
  grantGenerationCredits,
  recordStripeEvent,
  trackPurchaseFromCheckoutSession,
} from '@/lib/stripe-webhook';
import { trackRedditConversion } from '@/lib/reddit-capi';

vi.mock('@/lib/reddit-capi', () => ({
  trackRedditConversion: vi.fn().mockResolvedValue(undefined),
}));

const mockedTrack = vi.mocked(trackRedditConversion);

function makeSession(overrides: Partial<Stripe.Checkout.Session> = {}): Stripe.Checkout.Session {
  return {
    id: 'cs_test_123',
    object: 'checkout.session',
    mode: 'subscription',
    payment_status: 'paid',
    amount_total: 999,
    currency: 'usd',
    customer_email: null,
    customer_details: { email: 'buyer@example.com' } as Stripe.Checkout.Session.CustomerDetails,
    metadata: { user_id: 'user-1' },
    ...overrides,
  } as Stripe.Checkout.Session;
}

function makeSupabase(insertResult: { error: any } | Error) {
  const insert =
    insertResult instanceof Error
      ? vi.fn().mockRejectedValue(insertResult)
      : vi.fn().mockResolvedValue(insertResult);
  const from = vi.fn().mockReturnValue({ insert });
  return { client: { from } as any, insert, from };
}

describe('trackPurchaseFromCheckoutSession', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('sends a Reddit Purchase with the session id, email, value and currency when paid', async () => {
    const handled = await trackPurchaseFromCheckoutSession(makeSession());

    expect(handled).toBe(true);
    expect(mockedTrack).toHaveBeenCalledTimes(1);
    expect(mockedTrack).toHaveBeenCalledWith({
      eventName: 'Purchase',
      conversionId: 'cs_test_123',
      email: 'buyer@example.com',
      externalId: 'user-1',
      value: 9.99,
      currency: 'USD',
    });
  });

  it('falls back to customer_email when customer_details has no email', async () => {
    await trackPurchaseFromCheckoutSession(
      makeSession({ customer_details: null, customer_email: 'fallback@example.com' })
    );

    expect(mockedTrack.mock.calls[0][0].email).toBe('fallback@example.com');
  });

  it('still sends when there is no email, no metadata, no amount and no currency', async () => {
    const handled = await trackPurchaseFromCheckoutSession(
      makeSession({
        customer_details: null,
        customer_email: null,
        metadata: null,
        amount_total: null,
        currency: null,
      })
    );

    expect(handled).toBe(true);
    expect(mockedTrack).toHaveBeenCalledWith({
      eventName: 'Purchase',
      conversionId: 'cs_test_123',
      email: undefined,
      externalId: undefined,
      value: undefined,
      currency: undefined,
    });
  });

  it('handles a one-off payment-mode session the same way', async () => {
    await expect(
      trackPurchaseFromCheckoutSession(makeSession({ mode: 'payment', subscription: null }))
    ).resolves.toBe(true);
    expect(mockedTrack).toHaveBeenCalledTimes(1);
  });

  it.each(['unpaid', 'no_payment_required'] as const)(
    'does not send anything when payment_status is %s',
    async (payment_status) => {
      const handled = await trackPurchaseFromCheckoutSession(makeSession({ payment_status }));

      expect(handled).toBe(false);
      expect(mockedTrack).not.toHaveBeenCalled();
    }
  );
});

describe('recordStripeEvent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns true the first time an event id is seen', async () => {
    const { client, from, insert } = makeSupabase({ error: null });

    await expect(recordStripeEvent(client, { id: 'evt_1', type: 'checkout.session.completed' })).resolves.toBe(true);
    expect(from).toHaveBeenCalledWith('stripe_webhook_events');
    expect(insert).toHaveBeenCalledWith({ id: 'evt_1', type: 'checkout.session.completed' });
  });

  it('returns false on a duplicate delivery (unique violation)', async () => {
    const { client } = makeSupabase({ error: { code: '23505', message: 'duplicate key' } });

    await expect(recordStripeEvent(client, { id: 'evt_1', type: 'checkout.session.completed' })).resolves.toBe(false);
  });

  it.each([
    ['Postgres: relation does not exist', { code: '42P01', message: 'relation "stripe_webhook_events" does not exist' }],
    ['PostgREST: table not in schema cache (migration not applied)', { code: 'PGRST205', message: "Could not find the table 'public.stripe_webhook_events' in the schema cache" }],
    ['network failure surfaced as an error object', { code: '', message: 'TypeError: fetch failed' }],
  ])('fails open on any other storage error: %s', async (_label, error) => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { client } = makeSupabase({ error });

    await expect(recordStripeEvent(client, { id: 'evt_2', type: 'checkout.session.completed' })).resolves.toBe(true);
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it('fails open when the client throws instead of returning an error', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { client } = makeSupabase(new Error('boom'));

    await expect(recordStripeEvent(client, { id: 'evt_3', type: 'checkout.session.completed' })).resolves.toBe(true);
    errorSpy.mockRestore();
  });
});

describe('generationCreditsFromSession', () => {
  it('reads the credit count from a paid payment-mode session', () => {
    expect(
      generationCreditsFromSession(
        makeSession({ mode: 'payment', metadata: { user_id: 'user-1', generation_credits: '2' } })
      )
    ).toBe(2);
  });

  it.each([
    ['a subscription session', { mode: 'subscription', metadata: { generation_credits: '1' } }],
    ['an unpaid session', { mode: 'payment', payment_status: 'unpaid', metadata: { generation_credits: '1' } }],
    ['no metadata', { mode: 'payment', metadata: null }],
    ['a non-numeric count', { mode: 'payment', metadata: { generation_credits: 'lots' } }],
    ['a negative count', { mode: 'payment', metadata: { generation_credits: '-1' } }],
  ])('is 0 for %s', (_label, overrides) => {
    expect(generationCreditsFromSession(makeSession(overrides as any))).toBe(0);
  });
});

describe('grantGenerationCredits', () => {
  function makeGrantClient(rpcResult: { data?: any; error: any } = { data: 1, error: null }) {
    const rpc = vi.fn().mockResolvedValue(rpcResult);
    const from = vi.fn(() => {
      throw new Error('the grant must go through the RPC, not a table write');
    });
    return { client: { from, rpc } as any, from, rpc };
  }

  const creditSession = () =>
    makeSession({
      mode: 'payment',
      amount_total: 299,
      metadata: { user_id: 'user-1', generation_credits: '1' },
    });

  it('grants through grant_generation_purchase (ledger row + balance in one transaction)', async () => {
    const { client, rpc } = makeGrantClient({ data: 1, error: null });

    await expect(grantGenerationCredits(client, creditSession())).resolves.toEqual({
      granted: true,
      userId: 'user-1',
      credits: 1,
    });
    expect(rpc).toHaveBeenCalledWith('grant_generation_purchase', {
      p_user_id: 'user-1',
      p_checkout_session_id: 'cs_test_123',
      p_credits: 1,
      p_amount_cents: 299,
      p_currency: 'usd',
    });
  });

  it('reports already_granted when the RPC returns NULL (session already in the ledger)', async () => {
    const { client } = makeGrantClient({ data: null, error: null });

    await expect(grantGenerationCredits(client, creditSession())).resolves.toEqual({
      granted: false,
      reason: 'already_granted',
    });
  });

  it('throws (so the webhook returns 500 and Stripe retries) when the RPC fails', async () => {
    const { client } = makeGrantClient({ data: null, error: { message: 'db down' } });

    await expect(grantGenerationCredits(client, creditSession())).rejects.toBeTruthy();
  });

  it('does nothing for a session that is not a credit purchase', async () => {
    const { client, rpc } = makeGrantClient();

    await expect(grantGenerationCredits(client, makeSession())).resolves.toEqual({
      granted: false,
      reason: 'not_a_credit_purchase',
    });
    expect(rpc).not.toHaveBeenCalled();
  });

  it('does nothing without a user_id', async () => {
    const { client, rpc } = makeGrantClient();

    await expect(
      grantGenerationCredits(client, makeSession({ mode: 'payment', metadata: { generation_credits: '1' } }))
    ).resolves.toEqual({ granted: false, reason: 'missing_user' });
    expect(rpc).not.toHaveBeenCalled();
  });
});
