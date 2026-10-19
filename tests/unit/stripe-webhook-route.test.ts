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
  const rpc = vi.fn().mockResolvedValue({ data: 100, error: null });
  const captureServerEvent = vi.fn().mockResolvedValue(undefined);

  // Billing recovery (lib/lifecycle/billing-send.ts): the ledger, the
  // consent tables, the account email, Stripe's invoice and the mailer.
  const ledgerInsert = vi.fn().mockResolvedValue({ error: null });
  const ledgerUpdateEq = vi.fn().mockResolvedValue({ error: null });
  const ledgerUpdate = vi.fn().mockReturnValue({
    eq: () => ({ eq: () => ({ eq: ledgerUpdateEq }) }),
  });
  const suppressionMaybeSingle = vi.fn().mockResolvedValue({ data: null, error: null });
  const preferenceMaybeSingle = vi.fn().mockResolvedValue({ data: null, error: null });
  const getUserById = vi.fn().mockResolvedValue({ data: { user: { email: 'Pro@Example.com' } }, error: null });
  const invoiceRetrieve = vi.fn();
  const subscriptionsList = vi.fn().mockResolvedValue({ data: [] });
  const resendSend = vi.fn().mockResolvedValue({ data: { id: 'msg_1' }, error: null });
  // The checkout-recovery cooldown read (delivered recovery emails to the
  // user in the last week): none by default.
  const ledgerRecentLimit = vi.fn().mockResolvedValue({ data: [], error: null });
  const ledgerSelect = vi.fn().mockReturnValue({
    eq: () => ({ in: () => ({ not: () => ({ gte: () => ({ limit: ledgerRecentLimit }) }) }) }),
  });

  const from = vi.fn((table: string) => {
    if (table === 'stripe_webhook_events') return { insert: eventsInsert };
    if (table === 'user_usage') return { update: usageUpdate, upsert: usageUpsert, select: usageSelect };
    if (table === 'lifecycle_emails') return { insert: ledgerInsert, update: ledgerUpdate, select: ledgerSelect };
    if (table === 'email_suppressions') {
      return { select: () => ({ eq: () => ({ maybeSingle: suppressionMaybeSingle }) }) };
    }
    if (table === 'email_preferences') {
      return { select: () => ({ eq: () => ({ maybeSingle: preferenceMaybeSingle }) }) };
    }
    throw new Error(`unexpected table ${table}`);
  });

  return {
    constructEvent,
    trackRedditConversion,
    eventsInsert,
    usageUpdate,
    usageUpdateEq,
    usageUpsert,
    usageMaybeSingle,
    rpc,
    captureServerEvent,
    from,
    ledgerInsert,
    ledgerUpdateEq,
    suppressionMaybeSingle,
    preferenceMaybeSingle,
    getUserById,
    invoiceRetrieve,
    subscriptionsList,
    resendSend,
    ledgerRecentLimit,
  };
});

vi.mock('stripe', () => ({
  default: class StripeMock {
    webhooks = { constructEvent: mocks.constructEvent };
    checkout = { sessions: { listLineItems: vi.fn().mockResolvedValue({ data: [] }) } };
    invoices = { retrieve: mocks.invoiceRetrieve };
    subscriptions = { list: mocks.subscriptionsList };
  },
}));

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: mocks.from,
    rpc: mocks.rpc,
    auth: { admin: { getUserById: mocks.getUserById } },
  }),
}));

vi.mock('@/lib/email/client', () => ({
  resend: { emails: { send: mocks.resendSend } },
  FROM_ADDRESS: 'Octree <test@example.com>',
}));

vi.mock('@/lib/posthog-server', () => ({
  afterResponse: (work: () => Promise<void>) => void work(),
  captureServerEvent: mocks.captureServerEvent,
  captureServerEventAfterResponse: (...args: unknown[]) => void mocks.captureServerEvent(...args),
  captureServerExceptionAfterResponse: vi.fn(),
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
// Signs the unsubscribe links in the recovery emails.
process.env.CRON_SECRET = 'cron-secret-placeholder';

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

function openInvoice(overrides: Record<string, unknown> = {}) {
  return {
    id: 'in_1',
    object: 'invoice',
    status: 'open',
    amount_due: 999,
    amount_remaining: 999,
    currency: 'usd',
    hosted_invoice_url: 'https://invoice.stripe.com/i/in_1',
    next_payment_attempt: 1_700_500_000,
    ...overrides,
  };
}

/** customer.subscription.updated with Stripe's previous_attributes. */
function subscriptionUpdate(
  overrides: Record<string, unknown>,
  previous: Record<string, unknown> | undefined,
  id = 'evt_sub_update_1'
) {
  const event = subscriptionEvent('customer.subscription.updated', { latest_invoice: 'in_1', ...overrides });
  return { ...event, id, data: { ...event.data, previous_attributes: previous } };
}

function expiredSessionEvent(overrides: Record<string, unknown> = {}) {
  return {
    id: 'evt_expired_1',
    type: 'checkout.session.expired',
    data: {
      object: {
        id: 'cs_expired_1',
        object: 'checkout.session',
        mode: 'subscription',
        status: 'expired',
        payment_status: 'unpaid',
        amount_total: 999,
        currency: 'usd',
        customer: null,
        customer_email: 'pro@example.com',
        metadata: { user_id: 'user-1', plan: 'monthly' },
        after_expiration: {
          recovery: {
            enabled: true,
            allow_promotion_codes: true,
            expires_at: 1_703_000_000,
            url: 'https://checkout.stripe.com/c/pay/recovery_1',
          },
        },
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
    mocks.rpc.mockResolvedValue({ data: 100, error: null });
    mocks.trackRedditConversion.mockResolvedValue(undefined);
    mocks.ledgerInsert.mockResolvedValue({ error: null });
    mocks.ledgerUpdateEq.mockResolvedValue({ error: null });
    mocks.suppressionMaybeSingle.mockResolvedValue({ data: null, error: null });
    mocks.preferenceMaybeSingle.mockResolvedValue({ data: null, error: null });
    mocks.getUserById.mockResolvedValue({ data: { user: { email: 'Pro@Example.com' } }, error: null });
    mocks.invoiceRetrieve.mockResolvedValue(openInvoice());
    mocks.subscriptionsList.mockResolvedValue({ data: [] });
    mocks.resendSend.mockResolvedValue({ data: { id: 'msg_1' }, error: null });
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  describe('checkout.session.completed for a credit pack (mode: payment)', () => {
    const creditsOverrides = {
      id: 'cs_credits_1',
      mode: 'payment',
      amount_total: 500,
      metadata: { user_id: 'user-1', plan: 'credits_100', credits: '100' },
    };
    const grantArgs = {
      p_user_id: 'user-1',
      p_checkout_session_id: 'cs_credits_1',
      p_credits: 100,
      p_amount_cents: 500,
      p_currency: 'usd',
    };

    it('grants the credits through grant_credit_purchase and captures credits_purchased', async () => {
      mocks.constructEvent.mockReturnValue(checkoutEvent(creditsOverrides));

      const res = await POST(makeRequest());

      expect(res.status).toBe(200);
      expect(mocks.rpc).toHaveBeenCalledTimes(1);
      expect(mocks.rpc).toHaveBeenCalledWith('grant_credit_purchase', grantArgs);
      expect(mocks.captureServerEvent).toHaveBeenCalledWith('user-1', 'credits_purchased', {
        credits: 100,
        amount: 5,
        currency: 'USD',
      });
      // Not a subscription: no subscription_started, no user_usage subscription write.
      expect(mocks.captureServerEvent).not.toHaveBeenCalledWith('user-1', 'subscription_started', expect.anything());
      expect(mocks.usageUpdate).not.toHaveBeenCalled();
      // The event is still logged and the Reddit Purchase still fires for a paid session.
      expect(mocks.eventsInsert).toHaveBeenCalledWith({ id: 'evt_checkout_1', type: 'checkout.session.completed' });
      expect(mocks.trackRedditConversion).toHaveBeenCalledTimes(1);
    });

    it('grants once when the same session comes back under a new event id', async () => {
      mocks.constructEvent.mockReturnValue(checkoutEvent({ ...creditsOverrides }));
      await POST(makeRequest());

      mocks.constructEvent.mockReturnValue({ ...checkoutEvent(creditsOverrides), id: 'evt_checkout_2' });
      mocks.rpc.mockResolvedValue({ data: null, error: null }); // ledger already has cs_credits_1
      const res = await POST(makeRequest());

      expect(res.status).toBe(200);
      expect(mocks.rpc).toHaveBeenCalledTimes(2);
      expect(mocks.captureServerEvent).toHaveBeenCalledTimes(1);
    });

    it('returns 500 so Stripe retries when the grant fails, and the retry of the same event still grants', async () => {
      mocks.constructEvent.mockReturnValue(checkoutEvent(creditsOverrides));
      mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: '42883', message: 'function does not exist' } });

      const failed = await POST(makeRequest());

      expect(failed.status).toBe(500);
      // The event id must not be logged before the grant succeeded, or the
      // retry below would be dropped as a duplicate and the credits lost.
      expect(mocks.eventsInsert).not.toHaveBeenCalled();
      expect(mocks.captureServerEvent).not.toHaveBeenCalled();

      // Stripe redelivers the same event id (the log would now refuse it).
      mocks.eventsInsert.mockResolvedValue({ error: { code: '23505', message: 'duplicate key' } });
      const retried = await POST(makeRequest());

      expect(retried.status).toBe(200);
      expect(mocks.rpc).toHaveBeenCalledTimes(2);
      expect(mocks.captureServerEvent).toHaveBeenCalledWith('user-1', 'credits_purchased', expect.anything());
      // Conversion tracking is keyed on the event log, so it is skipped on the replay.
      expect(mocks.trackRedditConversion).not.toHaveBeenCalled();
    });

    it('does nothing for a payment-mode session without credits metadata', async () => {
      mocks.constructEvent.mockReturnValue(checkoutEvent({ mode: 'payment', metadata: { user_id: 'user-1' } }));

      const res = await POST(makeRequest());

      expect(res.status).toBe(200);
      expect(mocks.rpc).not.toHaveBeenCalled();
    });
  });

  describe('checkout.session.completed for a one-off generation credit (mode: payment)', () => {
    const generationOverrides = {
      id: 'cs_generate_1',
      mode: 'payment',
      amount_total: 299,
      metadata: { user_id: 'user-1', plan: 'generate_single', generation_credits: '1' },
    };
    const grantArgs = {
      p_user_id: 'user-1',
      p_checkout_session_id: 'cs_generate_1',
      p_credits: 1,
      p_amount_cents: 299,
      p_currency: 'usd',
    };

    it('grants the credit through grant_generation_purchase and captures generation_purchased', async () => {
      mocks.constructEvent.mockReturnValue(checkoutEvent(generationOverrides));
      mocks.rpc.mockResolvedValue({ data: 1, error: null });

      const res = await POST(makeRequest());

      expect(res.status).toBe(200);
      await expect(res.json()).resolves.toEqual({ received: true });
      // Only the generation RPC: the edit-credit grant does not run without `metadata.credits`.
      expect(mocks.rpc).toHaveBeenCalledTimes(1);
      expect(mocks.rpc).toHaveBeenCalledWith('grant_generation_purchase', grantArgs);
      expect(mocks.captureServerEvent).toHaveBeenCalledWith('user-1', 'generation_purchased', {
        credits: 1,
        amount: 2.99,
        currency: 'USD',
      });
      expect(mocks.captureServerEvent).not.toHaveBeenCalledWith('user-1', 'credits_purchased', expect.anything());
      expect(mocks.captureServerEvent).not.toHaveBeenCalledWith('user-1', 'subscription_started', expect.anything());
      expect(mocks.usageUpdate).not.toHaveBeenCalled();
      // The grant lands before the idempotency log is written.
      expect(mocks.rpc.mock.invocationCallOrder[0]).toBeLessThan(mocks.eventsInsert.mock.invocationCallOrder[0]);
      expect(mocks.eventsInsert).toHaveBeenCalledWith({ id: 'evt_checkout_1', type: 'checkout.session.completed' });
      expect(mocks.trackRedditConversion).toHaveBeenCalledTimes(1);
    });

    it('grants nothing when Stripe redelivers the same event (the ledger answers NULL)', async () => {
      mocks.constructEvent.mockReturnValue(checkoutEvent(generationOverrides));
      mocks.rpc.mockResolvedValue({ data: null, error: null });
      mocks.eventsInsert.mockResolvedValue({ error: { code: '23505', message: 'duplicate key' } });

      const res = await POST(makeRequest());

      expect(res.status).toBe(200);
      expect(mocks.rpc).toHaveBeenCalledTimes(1);
      expect(mocks.captureServerEvent).not.toHaveBeenCalled();
      // Conversion tracking is keyed on the event log, so it is skipped on the replay.
      expect(mocks.trackRedditConversion).not.toHaveBeenCalled();
    });

    it('returns 500 so Stripe retries when the grant RPC fails, and the retry grants', async () => {
      mocks.constructEvent.mockReturnValue(checkoutEvent(generationOverrides));
      mocks.rpc.mockResolvedValueOnce({ data: null, error: { message: 'db down' } });

      const failed = await POST(makeRequest());

      expect(failed.status).toBe(500);
      expect(mocks.eventsInsert).not.toHaveBeenCalled();
      expect(mocks.captureServerEvent).not.toHaveBeenCalled();

      mocks.rpc.mockResolvedValueOnce({ data: 1, error: null });
      const retried = await POST(makeRequest());

      expect(retried.status).toBe(200);
      expect(mocks.rpc).toHaveBeenCalledTimes(2);
      expect(mocks.captureServerEvent).toHaveBeenCalledWith('user-1', 'generation_purchased', expect.anything());
    });

    it.each([
      ['a subscription session', { mode: 'subscription', metadata: { user_id: 'user-1', generation_credits: '1' } }],
      ['a payment session without credit metadata', { mode: 'payment', metadata: { user_id: 'user-1' } }],
      ['an unpaid payment session', { ...generationOverrides, payment_status: 'unpaid' }],
      ['a zero credit count', { ...generationOverrides, metadata: { user_id: 'user-1', generation_credits: '0' } }],
    ])('grants nothing for %s', async (_label, overrides) => {
      mocks.constructEvent.mockReturnValue(checkoutEvent(overrides));

      const res = await POST(makeRequest());

      expect(res.status).toBe(200);
      expect(mocks.rpc).not.toHaveBeenCalled();
    });

    it('logs and returns 200 for a credit session with no user_id (nothing to grant to)', async () => {
      mocks.constructEvent.mockReturnValue(
        checkoutEvent({ ...generationOverrides, metadata: { generation_credits: '1' } })
      );

      const res = await POST(makeRequest());

      expect(res.status).toBe(200);
      expect(mocks.rpc).not.toHaveBeenCalled();
      expect(errorSpy).toHaveBeenCalled();
    });

    it('a session carrying both one-off products grants each through its own RPC', async () => {
      mocks.constructEvent.mockReturnValue(
        checkoutEvent({
          ...generationOverrides,
          metadata: { user_id: 'user-1', credits: '100', generation_credits: '1' },
        })
      );
      mocks.rpc.mockResolvedValue({ data: 1, error: null });

      const res = await POST(makeRequest());

      expect(res.status).toBe(200);
      expect(mocks.rpc).toHaveBeenCalledWith('grant_credit_purchase', expect.objectContaining({ p_credits: 100 }));
      expect(mocks.rpc).toHaveBeenCalledWith('grant_generation_purchase', expect.objectContaining({ p_credits: 1 }));
    });
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

describe('billing recovery: dunning on customer.subscription.updated', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.usageMaybeSingle.mockResolvedValue({
      data: { is_pro: true, stripe_subscription_id: 'sub_1', current_period_start: null, subscription_status: 'active' },
      error: null,
    });
    mocks.ledgerInsert.mockResolvedValue({ error: null });
    mocks.ledgerUpdateEq.mockResolvedValue({ error: null });
    mocks.suppressionMaybeSingle.mockResolvedValue({ data: null, error: null });
    mocks.getUserById.mockResolvedValue({ data: { user: { email: 'Pro@Example.com' } }, error: null });
    mocks.invoiceRetrieve.mockResolvedValue(openInvoice());
    mocks.resendSend.mockResolvedValue({ data: { id: 'msg_1' }, error: null });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  it('active -> past_due sends the payment_failed email once, keyed on the invoice', async () => {
    mocks.constructEvent.mockReturnValue(subscriptionUpdate({ status: 'past_due' }, { status: 'active' }));

    const res = await POST(makeRequest());

    expect(res.status).toBe(200);
    expect(mocks.invoiceRetrieve).toHaveBeenCalledWith('in_1');
    expect(mocks.ledgerInsert).toHaveBeenCalledTimes(1);
    expect(mocks.ledgerInsert).toHaveBeenCalledWith({
      user_id: 'user-1',
      email: 'pro@example.com',
      template: 'payment_failed',
      ref: 'in_1',
      payload: expect.objectContaining({ subscription_id: 'sub_1', invoice_id: 'in_1', amount_cents: 999 }),
    });
    expect(mocks.resendSend).toHaveBeenCalledTimes(1);
    const mail = mocks.resendSend.mock.calls[0][0];
    expect(mail.to).toBe('pro@example.com');
    expect(mail.subject).toBe("Your Octree Pro payment didn't go through");
    expect(mail.html).toContain('https://invoice.stripe.com/i/in_1');
    expect(mail.text).toContain('$9.99');
    expect(mail.text).toContain('/settings');
    // Transactional: no unsubscribe link in the body.
    expect(mail.text).not.toContain('Unsubscribe');
    expect(mocks.ledgerUpdateEq).toHaveBeenCalledTimes(1); // resend_id stored
    expect(mocks.captureServerEvent).toHaveBeenCalledWith('user-1', 'subscription_past_due', { status: 'past_due' });
    expect(mocks.captureServerEvent).toHaveBeenCalledWith('user-1', 'payment_failed_email_sent', {
      template: 'payment_failed',
      amount: 9.99,
      currency: 'USD',
      has_retry: true,
    });
    expect(mocks.captureServerEvent).toHaveBeenCalledWith('user-1', 'lifecycle_email_sent', { template: 'payment_failed' });
    // The user_usage write happened as before.
    expect(mocks.usageUpdate).toHaveBeenCalledWith(expect.objectContaining({ subscription_status: 'past_due', is_pro: false }));
  });

  it('a redelivery (or a later update of the same delinquency) sends nothing: the ledger row exists', async () => {
    mocks.constructEvent.mockReturnValue(subscriptionUpdate({ status: 'past_due' }, { status: 'active' }, 'evt_sub_update_2'));
    mocks.ledgerInsert.mockResolvedValue({ error: { code: '23505', message: 'duplicate key' } });
    mocks.rpc.mockResolvedValue({ data: false, error: null }); // claim_lifecycle_retry: nothing retryable

    const res = await POST(makeRequest());

    expect(res.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith(
      'claim_lifecycle_retry',
      expect.objectContaining({ p_user_id: 'user-1', p_template: 'payment_failed', p_ref: 'in_1' })
    );
    expect(mocks.resendSend).not.toHaveBeenCalled();
    expect(mocks.captureServerEvent).not.toHaveBeenCalledWith('user-1', 'payment_failed_email_sent', expect.anything());
  });

  it.each([
    ['past_due -> active (recovered)', { status: 'active' }, { status: 'past_due' }],
    ['past_due -> unpaid (still delinquent)', { status: 'unpaid' }, { status: 'past_due' }],
    ['past_due, status unchanged (a retry attempt)', { status: 'past_due' }, { metadata: {} }],
    ['active, no status change', { status: 'active' }, { cancel_at_period_end: true }],
  ])('%s sends nothing', async (_label, overrides, previous) => {
    mocks.constructEvent.mockReturnValue(subscriptionUpdate(overrides, previous));

    const res = await POST(makeRequest());

    expect(res.status).toBe(200);
    expect(mocks.invoiceRetrieve).not.toHaveBeenCalled();
    expect(mocks.ledgerInsert).not.toHaveBeenCalled();
    expect(mocks.resendSend).not.toHaveBeenCalled();
  });

  it('respects email_suppressions: no send and no ledger row', async () => {
    mocks.constructEvent.mockReturnValue(subscriptionUpdate({ status: 'past_due' }, { status: 'active' }));
    mocks.suppressionMaybeSingle.mockResolvedValue({ data: { email: 'pro@example.com' }, error: null });

    const res = await POST(makeRequest());

    expect(res.status).toBe(200);
    expect(mocks.ledgerInsert).not.toHaveBeenCalled();
    expect(mocks.resendSend).not.toHaveBeenCalled();
  });

  it('fails open when the ledger lacks the new columns (migration pending): 200, no email', async () => {
    mocks.constructEvent.mockReturnValue(subscriptionUpdate({ status: 'past_due' }, { status: 'active' }));
    mocks.ledgerInsert.mockResolvedValue({
      error: { code: 'PGRST204', message: "Could not find the 'ref' column of 'lifecycle_emails' in the schema cache" },
    });

    const res = await POST(makeRequest());

    expect(res.status).toBe(200);
    expect(mocks.resendSend).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalledWith('claim_lifecycle_retry', expect.anything());
  });

  it('returns 200 when the invoice lookup or the mailer throws', async () => {
    mocks.constructEvent.mockReturnValue(subscriptionUpdate({ status: 'past_due' }, { status: 'active' }));
    mocks.invoiceRetrieve.mockRejectedValue(new Error('stripe down'));

    expect((await POST(makeRequest())).status).toBe(200);

    mocks.invoiceRetrieve.mockResolvedValue(openInvoice());
    mocks.resendSend.mockRejectedValue(new Error('resend down'));

    expect((await POST(makeRequest())).status).toBe(200);
  });

  it('skips the email when the subscription has no latest invoice', async () => {
    mocks.constructEvent.mockReturnValue(subscriptionUpdate({ status: 'past_due', latest_invoice: null }, { status: 'active' }));

    const res = await POST(makeRequest());

    expect(res.status).toBe(200);
    expect(mocks.invoiceRetrieve).not.toHaveBeenCalled();
    expect(mocks.resendSend).not.toHaveBeenCalled();
  });
});

describe('billing recovery: checkout.session.expired', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // A free user: no subscription on the row.
    mocks.usageMaybeSingle.mockResolvedValue({
      data: { is_pro: false, subscription_status: 'inactive', stripe_customer_id: null },
      error: null,
    });
    mocks.ledgerInsert.mockResolvedValue({ error: null });
    mocks.ledgerUpdateEq.mockResolvedValue({ error: null });
    mocks.suppressionMaybeSingle.mockResolvedValue({ data: null, error: null });
    mocks.preferenceMaybeSingle.mockResolvedValue({ data: null, error: null });
    mocks.getUserById.mockResolvedValue({ data: { user: { email: 'Pro@Example.com' } }, error: null });
    mocks.subscriptionsList.mockResolvedValue({ data: [] });
    mocks.resendSend.mockResolvedValue({ data: { id: 'msg_2' }, error: null });
    mocks.ledgerRecentLimit.mockResolvedValue({ data: [], error: null });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  it('emails the recovery URL once per session and reports checkout_abandoned', async () => {
    mocks.constructEvent.mockReturnValue(expiredSessionEvent());

    const res = await POST(makeRequest());

    expect(res.status).toBe(200);
    expect(mocks.captureServerEvent).toHaveBeenCalledWith('user-1', 'checkout_abandoned', {
      plan: 'monthly',
      amount: 9.99,
      currency: 'USD',
      mode: 'subscription',
      recoverable: true,
    });
    expect(mocks.ledgerInsert).toHaveBeenCalledWith({
      user_id: 'user-1',
      email: 'pro@example.com',
      template: 'checkout_recovery',
      ref: 'cs_expired_1',
      payload: expect.objectContaining({
        session_id: 'cs_expired_1',
        plan: 'monthly',
        mode: 'subscription',
        recovery_url: 'https://checkout.stripe.com/c/pay/recovery_1',
        recovery_expires_at: 1_703_000_000,
      }),
    });
    expect(mocks.resendSend).toHaveBeenCalledTimes(1);
    const mail = mocks.resendSend.mock.calls[0][0];
    expect(mail.to).toBe('pro@example.com');
    expect(mail.html).toContain('https://checkout.stripe.com/c/pay/recovery_1');
    // Marketing: one-click unsubscribe present.
    expect(mail.headers['List-Unsubscribe']).toMatch(/\/api\/email\/unsubscribe\?token=/);
    expect(mail.text).toContain('Unsubscribe');
    expect(mocks.captureServerEvent).toHaveBeenCalledWith('user-1', 'checkout_recovery_email_sent', {
      template: 'checkout_recovery',
      plan: 'monthly',
      has_offer: false,
    });
  });

  it('sends nothing when Stripe attached no recovery URL, but still reports the abandonment', async () => {
    mocks.constructEvent.mockReturnValue(expiredSessionEvent({ after_expiration: { recovery: null } }));

    const res = await POST(makeRequest());

    expect(res.status).toBe(200);
    expect(mocks.captureServerEvent).toHaveBeenCalledWith(
      'user-1',
      'checkout_abandoned',
      expect.objectContaining({ recoverable: false })
    );
    expect(mocks.ledgerInsert).not.toHaveBeenCalled();
    expect(mocks.resendSend).not.toHaveBeenCalled();
  });

  it('sends nothing when the user has subscribed since (user_usage)', async () => {
    mocks.constructEvent.mockReturnValue(expiredSessionEvent());
    mocks.usageMaybeSingle.mockResolvedValue({
      data: { is_pro: true, subscription_status: 'active', stripe_customer_id: 'cus_1' },
      error: null,
    });

    const res = await POST(makeRequest());

    expect(res.status).toBe(200);
    expect(mocks.ledgerInsert).not.toHaveBeenCalled();
    expect(mocks.resendSend).not.toHaveBeenCalled();
  });

  it('sends nothing when Stripe shows a live subscription on the session customer', async () => {
    mocks.constructEvent.mockReturnValue(expiredSessionEvent({ customer: 'cus_1' }));
    mocks.subscriptionsList.mockResolvedValue({ data: [{ id: 'sub_9', status: 'trialing' }] });

    const res = await POST(makeRequest());

    expect(res.status).toBe(200);
    expect(mocks.subscriptionsList).toHaveBeenCalledWith({ customer: 'cus_1', status: 'all', limit: 10 });
    expect(mocks.resendSend).not.toHaveBeenCalled();
  });

  it('sends nothing for a second abandoned session inside the per-user cooldown', async () => {
    mocks.constructEvent.mockReturnValue(expiredSessionEvent({ id: 'cs_expired_2' }));
    mocks.ledgerRecentLimit.mockResolvedValue({ data: [{ id: 'row_1' }], error: null });

    const res = await POST(makeRequest());

    expect(res.status).toBe(200);
    expect(mocks.captureServerEvent).toHaveBeenCalledWith('user-1', 'checkout_abandoned', expect.anything());
    expect(mocks.ledgerInsert).not.toHaveBeenCalled();
    expect(mocks.resendSend).not.toHaveBeenCalled();
  });

  it('a redelivery sends nothing (ledger row for the session exists)', async () => {
    mocks.constructEvent.mockReturnValue(expiredSessionEvent());
    mocks.ledgerInsert.mockResolvedValue({ error: { code: '23505', message: 'duplicate key' } });
    mocks.rpc.mockResolvedValue({ data: false, error: null });

    const res = await POST(makeRequest());

    expect(res.status).toBe(200);
    expect(mocks.resendSend).not.toHaveBeenCalled();
  });

  it('respects the marketing opt-out for recovery email', async () => {
    mocks.constructEvent.mockReturnValue(expiredSessionEvent());
    mocks.preferenceMaybeSingle.mockResolvedValue({ data: { marketing_opt_out: true }, error: null });

    const res = await POST(makeRequest());

    expect(res.status).toBe(200);
    expect(mocks.ledgerInsert).not.toHaveBeenCalled();
    expect(mocks.resendSend).not.toHaveBeenCalled();
  });

  it('ignores a session without user_id metadata', async () => {
    mocks.constructEvent.mockReturnValue(expiredSessionEvent({ metadata: {} }));

    const res = await POST(makeRequest());

    expect(res.status).toBe(200);
    expect(mocks.captureServerEvent).not.toHaveBeenCalled();
    expect(mocks.resendSend).not.toHaveBeenCalled();
  });
});
