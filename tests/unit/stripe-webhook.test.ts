import { describe, it, expect, beforeEach, vi } from 'vitest';
import type Stripe from 'stripe';

import {
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
