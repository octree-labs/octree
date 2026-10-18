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
    payment_status: 'paid',
    amount_total: 999,
    currency: 'usd',
    customer_email: null,
    customer_details: { email: 'buyer@example.com' } as Stripe.Checkout.Session.CustomerDetails,
    metadata: { user_id: 'user-1' },
    ...overrides,
  } as Stripe.Checkout.Session;
}

function makeSupabase(insertResult: { error: any }) {
  const insert = vi.fn().mockResolvedValue(insertResult);
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

  it('does not send anything when the session is not paid', async () => {
    const handled = await trackPurchaseFromCheckoutSession(
      makeSession({ payment_status: 'unpaid' })
    );

    expect(handled).toBe(false);
    expect(mockedTrack).not.toHaveBeenCalled();
  });
});

describe('recordStripeEvent', () => {
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

  it('fails open on any other storage error', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { client } = makeSupabase({ error: { code: '42P01', message: 'relation does not exist' } });

    await expect(recordStripeEvent(client, { id: 'evt_2', type: 'customer.subscription.updated' })).resolves.toBe(true);
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});
