import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * Route-level tests for app/api/webhooks/stripe/route.ts. Everything external
 * (Stripe signature check, Supabase service client, Reddit CAPI) is mocked so
 * the tests pin down the route's own behaviour: which events touch the
 * idempotency table, what a retry does, and what status Stripe gets back.
 */

const mocks = vi.hoisted(() => {
  const constructEvent = vi.fn();
  const trackRedditConversion = vi.fn().mockResolvedValue(undefined);

  // Per-table results; each test overrides what it needs.
  const eventsInsert = vi.fn().mockResolvedValue({ error: null });
  const usageUpdateEq = vi.fn().mockResolvedValue({ error: null });
  const usageUpdate = vi.fn().mockReturnValue({ eq: usageUpdateEq });
  const usageUpsert = vi.fn().mockResolvedValue({ error: null });
  // The row the route reads before writing, to decide whether the billing
  // period advanced (lib/subscription/billing-period.ts).
  const usageMaybeSingle = vi.fn().mockResolvedValue({ data: null, error: null });
  const usageSelect = vi.fn().mockReturnValue({ eq: () => ({ maybeSingle: usageMaybeSingle }) });

  const from = vi.fn((table: string) => {
    if (table === 'stripe_webhook_events') return { insert: eventsInsert };
    if (table === 'user_usage') return { update: usageUpdate, upsert: usageUpsert, select: usageSelect };
    throw new Error(`unexpected table ${table}`);
  });

  return {
    constructEvent, trackRedditConversion, eventsInsert, usageUpdate, usageUpdateEq, usageUpsert,
    usageMaybeSingle, from,
  };
});

vi.mock('stripe', () => ({
  default: class StripeMock {
    webhooks = { constructEvent: mocks.constructEvent };
  },
}));

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ from: mocks.from }),
}));

vi.mock('next/headers', () => ({
  headers: async () => ({
    get: (name: string) => (name === 'stripe-signature' ? 'sig_test' : null),
  }),
}));

vi.mock('@/lib/reddit-capi', () => ({
  trackRedditConversion: mocks.trackRedditConversion,
}));

process.env.STRIPE_SECRET_KEY = 'sk_test_placeholder';
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_placeholder';
process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-placeholder';

import { POST } from '@/app/api/webhooks/stripe/route';

function makeRequest() {
  return new Request('http://localhost/api/webhooks/stripe', { method: 'POST', body: '{}' });
}

function checkoutEvent(overrides: Record<string, unknown> = {}) {
  return {
    id: 'evt_checkout_1',
    type: 'checkout.session.completed',
    data: {
      object: {
        id: 'cs_test_1',
        object: 'checkout.session',
        mode: 'subscription',
        payment_status: 'paid',
        amount_total: 999,
        currency: 'usd',
        customer_details: { email: 'buyer@example.com' },
        customer_email: null,
        metadata: { user_id: 'user-1' },
        ...overrides,
      },
    },
  };
}

/** Run `fn` with the clock set to `seconds` (unix), so period ends in the fixtures are in the future. */
async function atUnixTime(seconds: number, fn: () => Promise<void>) {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(seconds * 1000));
  try {
    await fn();
  } finally {
    vi.useRealTimers();
  }
}

function subscriptionEvent(type: string, overrides: Record<string, unknown> = {}) {
  return {
    id: 'evt_sub_1',
    type,
    data: {
      object: {
        id: 'sub_1',
        object: 'subscription',
        customer: 'cus_1',
        status: 'active',
        current_period_start: 1_700_000_000,
        current_period_end: 1_702_592_000,
        cancel_at_period_end: false,
        metadata: { user_id: 'user-1' },
        ...overrides,
      },
    },
  };
}

describe('POST /api/webhooks/stripe', () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.eventsInsert.mockResolvedValue({ error: null });
    mocks.usageUpdateEq.mockResolvedValue({ error: null });
    mocks.usageUpsert.mockResolvedValue({ error: null });
    // Default: a free row that has never seen this subscription, so an
    // active event is a first activation and resets the monthly counter.
    mocks.usageMaybeSingle.mockResolvedValue({
      data: { is_pro: false, stripe_subscription_id: null, current_period_start: null },
      error: null,
    });
    mocks.trackRedditConversion.mockResolvedValue(undefined);
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  describe('checkout.session.completed', () => {
    it('records the event id, then sends one Reddit Purchase and returns 200', async () => {
      mocks.constructEvent.mockReturnValue(checkoutEvent());

      const res = await POST(makeRequest());

      expect(res.status).toBe(200);
      await expect(res.json()).resolves.toEqual({ received: true });
      expect(mocks.eventsInsert).toHaveBeenCalledWith({ id: 'evt_checkout_1', type: 'checkout.session.completed' });
      expect(mocks.trackRedditConversion).toHaveBeenCalledTimes(1);
      expect(mocks.trackRedditConversion.mock.calls[0][0]).toMatchObject({
        eventName: 'Purchase',
        conversionId: 'cs_test_1',
        email: 'buyer@example.com',
        externalId: 'user-1',
        value: 9.99,
        currency: 'USD',
      });
      // The subscription table is untouched by this event, as before the PR.
      expect(mocks.usageUpdate).not.toHaveBeenCalled();
    });

    it('skips the Reddit call and returns 200 when Stripe redelivers the same event', async () => {
      mocks.constructEvent.mockReturnValue(checkoutEvent());
      mocks.eventsInsert.mockResolvedValue({ error: { code: '23505', message: 'duplicate key' } });

      const res = await POST(makeRequest());

      expect(res.status).toBe(200);
      await expect(res.json()).resolves.toEqual({ received: true, duplicate: true });
      expect(mocks.trackRedditConversion).not.toHaveBeenCalled();
    });

    it('still sends the Purchase and returns 200 when the idempotency table does not exist yet', async () => {
      mocks.constructEvent.mockReturnValue(checkoutEvent());
      mocks.eventsInsert.mockResolvedValue({
        error: { code: 'PGRST205', message: "Could not find the table 'public.stripe_webhook_events'" },
      });

      const res = await POST(makeRequest());

      expect(res.status).toBe(200);
      expect(mocks.trackRedditConversion).toHaveBeenCalledTimes(1);
    });

    it('returns 200 when the Reddit call throws (a Reddit outage must not make Stripe retry)', async () => {
      mocks.constructEvent.mockReturnValue(checkoutEvent());
      mocks.trackRedditConversion.mockRejectedValue(new Error('reddit down'));

      const res = await POST(makeRequest());

      expect(res.status).toBe(200);
      await expect(res.json()).resolves.toEqual({ received: true });
    });

    it.each([
      ['unpaid', { payment_status: 'unpaid' }],
      ['no_payment_required (trial)', { payment_status: 'no_payment_required' }],
    ])('returns 200 without a Purchase when payment_status is %s', async (_label, overrides) => {
      mocks.constructEvent.mockReturnValue(checkoutEvent(overrides));

      const res = await POST(makeRequest());

      expect(res.status).toBe(200);
      expect(mocks.trackRedditConversion).not.toHaveBeenCalled();
    });

    it('does not throw for a payment-mode session with no customer_details and no metadata', async () => {
      mocks.constructEvent.mockReturnValue(
        checkoutEvent({ mode: 'payment', customer_details: null, customer_email: null, metadata: null, amount_total: null, currency: null })
      );

      const res = await POST(makeRequest());

      expect(res.status).toBe(200);
      expect(mocks.trackRedditConversion).toHaveBeenCalledTimes(1);
      expect(mocks.trackRedditConversion.mock.calls[0][0]).toMatchObject({ email: undefined, externalId: undefined });
    });
  });

  describe('customer.subscription.* (unchanged behaviour)', () => {
    it.each(['customer.subscription.created', 'customer.subscription.updated', 'customer.subscription.deleted'])(
      '%s updates user_usage without consulting the idempotency table',
      async (type) => {
        mocks.constructEvent.mockReturnValue(subscriptionEvent(type));

        await atUnixTime(1_700_000_000, async () => {
          const res = await POST(makeRequest());
          expect(res.status).toBe(200);
        });

        expect(mocks.eventsInsert).not.toHaveBeenCalled();
        expect(mocks.usageUpdate).toHaveBeenCalledTimes(1);
        expect(mocks.usageUpdate.mock.calls[0][0]).toMatchObject({
          stripe_customer_id: 'cus_1',
          stripe_subscription_id: 'sub_1',
          subscription_status: 'active',
          cancel_at_period_end: false,
          is_pro: true,
          monthly_edit_count: 0,
          // The billing date Stripe sent (current_period_end), not now + 30d.
          monthly_reset_date: new Date(1_702_592_000 * 1000).toISOString().slice(0, 10),
        });
        expect(mocks.usageUpdateEq).toHaveBeenCalledWith('user_id', 'user-1');
        expect(mocks.usageUpsert).toHaveBeenCalledWith(
          { user_id: 'user-1', onboarding_completed: true },
          { onConflict: 'user_id' }
        );
        expect(mocks.trackRedditConversion).not.toHaveBeenCalled();
      }
    );

    it('a retried subscription event is processed again (so a timed-out delivery can still heal user_usage)', async () => {
      mocks.constructEvent.mockReturnValue(subscriptionEvent('customer.subscription.updated'));

      await POST(makeRequest());
      await POST(makeRequest());

      expect(mocks.usageUpdate).toHaveBeenCalledTimes(2);
      expect(mocks.eventsInsert).not.toHaveBeenCalled();
    });

    it('a canceled subscription clears is_pro and does not reset the monthly counter', async () => {
      mocks.constructEvent.mockReturnValue(subscriptionEvent('customer.subscription.deleted', { status: 'canceled' }));

      await POST(makeRequest());

      const update = mocks.usageUpdate.mock.calls[0][0];
      expect(update).toMatchObject({ is_pro: false, subscription_status: 'canceled' });
      expect(update).not.toHaveProperty('monthly_edit_count');
      expect(mocks.usageUpsert).not.toHaveBeenCalled();
    });

    it('maps a paused subscription (pause_collection set, Stripe status active) to the free tier', async () => {
      mocks.constructEvent.mockReturnValue(
        subscriptionEvent('customer.subscription.updated', {
          pause_collection: { behavior: 'void', resumes_at: 1_705_000_000 },
        })
      );

      const res = await POST(makeRequest());

      expect(res.status).toBe(200);
      const update = mocks.usageUpdate.mock.calls[0][0];
      expect(update).toMatchObject({ is_pro: false, subscription_status: 'paused', stripe_subscription_id: 'sub_1' });
      expect(update).not.toHaveProperty('monthly_edit_count');
      expect(mocks.usageUpsert).not.toHaveBeenCalled();
    });

    it('keeps Pro for a pause taken mid-period until the paid period ends, then drops to the free tier', async () => {
      vi.useFakeTimers();
      try {
        const paused = {
          pause_collection: { behavior: 'void', resumes_at: 1_710_000_000 },
          metadata: { user_id: 'user-1', pause_paid_through: '1702592000' },
        };

        // The pause route just ran: the customer paid through 1_702_592_000.
        vi.setSystemTime(new Date(1_702_000_000 * 1000));
        mocks.constructEvent.mockReturnValue(subscriptionEvent('customer.subscription.updated', paused));
        await POST(makeRequest());
        expect(mocks.usageUpdate.mock.calls[0][0]).toMatchObject({ is_pro: true, subscription_status: 'active' });

        // The paid period rolled over (Stripe voided the invoice and sent another update).
        vi.setSystemTime(new Date(1_702_592_000 * 1000));
        mocks.usageUpdate.mockClear();
        mocks.constructEvent.mockReturnValue(
          subscriptionEvent('customer.subscription.updated', {
            ...paused,
            current_period_start: 1_702_592_000,
            current_period_end: 1_705_184_000,
          })
        );
        await POST(makeRequest());
        expect(mocks.usageUpdate.mock.calls[0][0]).toMatchObject({ is_pro: false, subscription_status: 'paused' });
      } finally {
        vi.useRealTimers();
      }
    });

    it('restores Pro when Stripe clears the pause (resumes_at reached or the Resume button)', async () => {
      mocks.constructEvent.mockReturnValue(
        subscriptionEvent('customer.subscription.updated', { pause_collection: null })
      );

      await POST(makeRequest());

      expect(mocks.usageUpdate.mock.calls[0][0]).toMatchObject({
        is_pro: true,
        subscription_status: 'active',
        monthly_edit_count: 0,
      });
    });

    describe('monthly counter resets only when the billing period advances', () => {
      // Stored row: Pro on sub_1, period started at the event's current_period_start.
      const samePeriodRow = {
        is_pro: true,
        stripe_subscription_id: 'sub_1',
        current_period_start: new Date(1_700_000_000 * 1000).toISOString(),
      };

      it('keeps monthly_edit_count when subscription.updated repeats the current period (cancel toggle, metadata, discount)', async () => {
        mocks.usageMaybeSingle.mockResolvedValue({ data: samePeriodRow, error: null });
        mocks.constructEvent.mockReturnValue(
          subscriptionEvent('customer.subscription.updated', { cancel_at_period_end: true })
        );

        const res = await POST(makeRequest());

        expect(res.status).toBe(200);
        const update = mocks.usageUpdate.mock.calls[0][0];
        expect(update).toMatchObject({ is_pro: true, cancel_at_period_end: true });
        expect(update).not.toHaveProperty('monthly_edit_count');
        expect(update).not.toHaveProperty('monthly_reset_date');
      });

      it('resets monthly_edit_count on renewal (current_period_start moved forward)', async () => {
        mocks.usageMaybeSingle.mockResolvedValue({ data: samePeriodRow, error: null });
        mocks.constructEvent.mockReturnValue(
          subscriptionEvent('customer.subscription.updated', {
            current_period_start: 1_702_592_000,
            current_period_end: 1_705_184_000,
          })
        );

        await atUnixTime(1_702_592_000, () => POST(makeRequest()).then(() => undefined));

        expect(mocks.usageUpdate.mock.calls[0][0]).toMatchObject({
          monthly_edit_count: 0,
          monthly_reset_date: new Date(1_705_184_000 * 1000).toISOString().slice(0, 10),
        });
      });

      it('resets when a different subscription replaces the stored one', async () => {
        mocks.usageMaybeSingle.mockResolvedValue({
          data: { ...samePeriodRow, stripe_subscription_id: 'sub_old' },
          error: null,
        });
        mocks.constructEvent.mockReturnValue(subscriptionEvent('customer.subscription.created'));

        await POST(makeRequest());

        expect(mocks.usageUpdate.mock.calls[0][0]).toMatchObject({ monthly_edit_count: 0 });
      });

      it('still writes the billing columns (without a reset) when the pre-read fails', async () => {
        mocks.usageMaybeSingle.mockResolvedValue({ data: null, error: { message: 'db down' } });
        mocks.constructEvent.mockReturnValue(subscriptionEvent('customer.subscription.updated'));

        const res = await POST(makeRequest());

        expect(res.status).toBe(200);
        expect(mocks.usageUpdate).toHaveBeenCalledTimes(1);
        expect(mocks.usageUpdate.mock.calls[0][0]).toMatchObject({ is_pro: true, stripe_subscription_id: 'sub_1' });
        expect(mocks.usageUpdate.mock.calls[0][0]).not.toHaveProperty('monthly_edit_count');
        expect(errorSpy).toHaveBeenCalled();
      });
    });

    it('still returns 400 when the subscription has no user_id in metadata', async () => {
      mocks.constructEvent.mockReturnValue(subscriptionEvent('customer.subscription.updated', { metadata: {} }));

      const res = await POST(makeRequest());

      expect(res.status).toBe(400);
      expect(mocks.usageUpdate).not.toHaveBeenCalled();
      expect(mocks.eventsInsert).not.toHaveBeenCalled();
    });

    it('still returns 200 when the user_usage update fails (error is logged, not retried)', async () => {
      mocks.constructEvent.mockReturnValue(subscriptionEvent('customer.subscription.updated'));
      mocks.usageUpdateEq.mockResolvedValue({ error: { message: 'db down' } });

      const res = await POST(makeRequest());

      expect(res.status).toBe(200);
      expect(errorSpy).toHaveBeenCalled();
    });
  });

  it('returns 400 and touches nothing when the signature is invalid', async () => {
    mocks.constructEvent.mockImplementation(() => {
      throw new Error('bad signature');
    });

    const res = await POST(makeRequest());

    expect(res.status).toBe(400);
    expect(mocks.from).not.toHaveBeenCalled();
    expect(mocks.trackRedditConversion).not.toHaveBeenCalled();
  });

  it('ignores event types it does not handle', async () => {
    mocks.constructEvent.mockReturnValue({ id: 'evt_x', type: 'invoice.paid', data: { object: {} } });

    const res = await POST(makeRequest());

    expect(res.status).toBe(200);
    expect(mocks.eventsInsert).not.toHaveBeenCalled();
    expect(mocks.usageUpdate).not.toHaveBeenCalled();
  });
});
