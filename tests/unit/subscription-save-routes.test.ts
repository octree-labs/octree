import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * The cancel-flow routes: app/api/subscription/{offers,pause,resume,discount}
 * and app/api/cancel-subscription. Stripe, Supabase auth and the customer
 * lookup are mocked, so these pin authorization (every route finds the
 * subscription through the caller's own customer), idempotency, and the
 * exact Stripe calls each offer makes.
 */

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  resolveStripeCustomer: vi.fn(),
  subscriptionsList: vi.fn(),
  subscriptionsUpdate: vi.fn(),
  couponsRetrieve: vi.fn(),
  couponsCreate: vi.fn(),
  captureEvent: vi.fn(),
  captureException: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { getUser: mocks.getUser }, from: vi.fn() }),
}));

vi.mock('@/lib/stripe-customer', () => ({
  resolveStripeCustomer: mocks.resolveStripeCustomer,
}));

vi.mock('@/lib/stripe', () => ({
  stripe: {
    subscriptions: { list: mocks.subscriptionsList, update: mocks.subscriptionsUpdate },
    coupons: { retrieve: mocks.couponsRetrieve, create: mocks.couponsCreate },
  },
}));

vi.mock('@/lib/posthog-server', () => ({
  captureServerEventAfterResponse: mocks.captureEvent,
  captureServerExceptionAfterResponse: mocks.captureException,
}));

import { GET as offers } from '@/app/api/subscription/offers/route';
import { POST as pause } from '@/app/api/subscription/pause/route';
import { POST as resume } from '@/app/api/subscription/resume/route';
import { POST as discount } from '@/app/api/subscription/discount/route';
import { POST as cancel } from '@/app/api/cancel-subscription/route';

const user = { id: 'user-1', email: 'payer@example.com' };

function post(body?: unknown) {
  return new Request('http://localhost/api/x', {
    method: 'POST',
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  });
}

function subscription(overrides: Record<string, unknown> = {}) {
  return {
    id: 'sub_1',
    object: 'subscription',
    customer: 'cus_1',
    status: 'active',
    cancel_at_period_end: false,
    current_period_end: 1_702_592_000,
    pause_collection: null,
    discounts: [],
    discount: null,
    items: { data: [{ price: { unit_amount: 999, currency: 'usd', recurring: { interval: 'month' } } }] },
    ...overrides,
  };
}

/** Signed in, owns cus_1, which has `sub` (or nothing). */
function signedInWith(sub: ReturnType<typeof subscription> | null) {
  mocks.getUser.mockResolvedValue({ data: { user }, error: null });
  mocks.resolveStripeCustomer.mockResolvedValue({ customerId: 'cus_1', source: 'stored' });
  mocks.subscriptionsList.mockImplementation(async (params: any) => ({
    data: sub && params.status === sub.status && params.customer === 'cus_1' ? [sub] : [],
  }));
  mocks.subscriptionsUpdate.mockImplementation(async (id: string, params: any) => ({
    ...(sub ?? subscription()),
    id,
    ...params,
    pause_collection: params.pause_collection === '' ? null : (params.pause_collection ?? sub?.pause_collection ?? null),
  }));
}

function stripeError(code: string) {
  return Object.assign(new Error(code), { code, type: 'StripeInvalidRequestError' });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  mocks.couponsRetrieve.mockResolvedValue({ id: 'save50-2mo', percent_off: 50, duration_in_months: 2 });
});

describe('authorization (shared by every route)', () => {
  const routes: Array<[string, () => Promise<Response>]> = [
    ['offers', () => offers()],
    ['pause', () => pause(post({ months: 1 }))],
    ['resume', () => resume()],
    ['discount', () => discount()],
    ['cancel', () => cancel(post({ feedback: 'unused' }))],
  ];

  it.each(routes)('%s returns 401 when signed out and touches Stripe only to look nothing up', async (_name, call) => {
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: { message: 'no session' } });

    const res = await call();

    expect(res.status).toBe(401);
    expect(mocks.resolveStripeCustomer).not.toHaveBeenCalled();
    expect(mocks.subscriptionsUpdate).not.toHaveBeenCalled();
  });

  it.each(routes)('%s returns 404 when the user has no Stripe customer', async (_name, call) => {
    mocks.getUser.mockResolvedValue({ data: { user }, error: null });
    mocks.resolveStripeCustomer.mockResolvedValue(null);

    const res = await call();

    expect(res.status).toBe(404);
    expect(mocks.subscriptionsList).not.toHaveBeenCalled();
    expect(mocks.subscriptionsUpdate).not.toHaveBeenCalled();
  });

  it.each(routes)('%s returns 404 when the customer has no live subscription', async (_name, call) => {
    signedInWith(null);

    const res = await call();

    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toEqual({ error: 'No active subscription found' });
    expect(mocks.subscriptionsUpdate).not.toHaveBeenCalled();
  });

  it('only ever lists subscriptions for the resolved customer, never one named by the request', async () => {
    signedInWith(subscription());

    await pause(post({ months: 2, subscriptionId: 'sub_someone_elses' }));

    for (const call of mocks.subscriptionsList.mock.calls) {
      expect(call[0]).toMatchObject({ customer: 'cus_1' });
    }
    expect(mocks.subscriptionsUpdate).toHaveBeenCalledWith('sub_1', expect.anything());
  });

  it('falls back to a trialing subscription when there is no active one', async () => {
    signedInWith(subscription({ status: 'trialing' }));

    const res = await offers();

    expect(res.status).toBe(200);
    expect(mocks.subscriptionsList).toHaveBeenCalledTimes(2);
  });
});

describe('GET /api/subscription/offers', () => {
  it('describes the subscription and captures cancel_flow_opened', async () => {
    signedInWith(subscription());

    const res = await offers();

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      subscription: {
        id: 'sub_1',
        status: 'active',
        effective_status: 'active',
        cancel_at_period_end: false,
        current_period_end: 1_702_592_000,
        paused_until: null,
        pause_paid_through: null,
        has_discount: false,
        discount_coupon_id: null,
        price: { unit_amount: 999, currency: 'usd', interval: 'month' },
      },
    });
    expect(mocks.captureEvent).toHaveBeenCalledWith('user-1', 'cancel_flow_opened', {
      is_paused: false,
      has_discount: false,
      cancel_at_period_end: false,
    });
  });
});

describe('POST /api/subscription/pause', () => {
  it('rejects a month count outside 1-3 before looking anything up', async () => {
    for (const months of [0, 4, '2', undefined]) {
      const res = await pause(post({ months }));
      expect(res.status).toBe(400);
    }
    expect(mocks.getUser).not.toHaveBeenCalled();
  });

  it('rejects a body that is not JSON', async () => {
    const res = await pause(post('not json'));
    expect(res.status).toBe(400);
  });

  it('pauses with behavior void for N months after the paid period, keeps Pro until then, turns renewal back on, and captures both events', async () => {
    // The paid period runs to 1_702_592_000 = 2023-12-14T22:13:20Z. The pause
    // is counted from there (not from today), so the customer keeps the Pro
    // time they already paid for, exactly as cancelling would.
    signedInWith(subscription({ cancel_at_period_end: true }));

    const res = await pause(post({ months: 2 }));

    expect(res.status).toBe(200);
    const expectedResume = Math.floor(Date.UTC(2024, 1, 14, 22, 13, 20) / 1000);
    expect(mocks.subscriptionsUpdate).toHaveBeenCalledWith('sub_1', {
      pause_collection: { behavior: 'void', resumes_at: expectedResume },
      cancel_at_period_end: false,
      metadata: { pause_paid_through: '1702592000' },
    });
    const body = await res.json();
    expect(body).toMatchObject({ success: true, alreadyPaused: false });
    expect(body.subscription.paused_until).toBe(expectedResume);
    expect(body.subscription.pause_paid_through).toBe(1_702_592_000);
    expect(mocks.captureEvent).toHaveBeenCalledWith('user-1', 'cancel_offer_accepted', { offer: 'pause' });
    expect(mocks.captureEvent).toHaveBeenCalledWith('user-1', 'subscription_paused', {
      months: 2,
      resumes_at: expectedResume,
    });
  });

  it('never resets the paid-through marker the webhook relies on to something earlier than the period end', async () => {
    signedInWith(subscription({ current_period_end: 4_102_444_800 /* 2100-01-01 */ }));

    await pause(post({ months: 1 }));

    const params = mocks.subscriptionsUpdate.mock.calls[0][1];
    expect(params.metadata.pause_paid_through).toBe('4102444800');
    expect(params.pause_collection.resumes_at).toBe(Math.floor(Date.UTC(2100, 1, 1) / 1000));
  });

  it('is idempotent: an already paused subscription is returned without another update', async () => {
    signedInWith(subscription({ pause_collection: { behavior: 'void', resumes_at: 1_705_000_000 } }));

    const res = await pause(post({ months: 3 }));

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      success: true,
      alreadyPaused: true,
      subscription: { paused_until: 1_705_000_000 },
    });
    expect(mocks.subscriptionsUpdate).not.toHaveBeenCalled();
    expect(mocks.captureEvent).not.toHaveBeenCalled();
  });

  it('returns 500 JSON when Stripe fails', async () => {
    signedInWith(subscription());
    mocks.subscriptionsUpdate.mockRejectedValue(new Error('stripe down'));

    const res = await pause(post({ months: 1 }));

    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toEqual({ error: 'Failed to pause subscription' });
    expect(mocks.captureException).toHaveBeenCalled();
  });
});

describe('POST /api/subscription/resume', () => {
  it('clears pause_collection and captures subscription_resumed', async () => {
    signedInWith(subscription({ pause_collection: { behavior: 'void', resumes_at: 1_705_000_000 } }));

    const res = await resume();

    expect(res.status).toBe(200);
    expect(mocks.subscriptionsUpdate).toHaveBeenCalledWith('sub_1', {
      pause_collection: '',
      metadata: { pause_paid_through: null },
    });
    await expect(res.json()).resolves.toMatchObject({
      success: true,
      alreadyActive: false,
      subscription: { paused_until: null },
    });
    expect(mocks.captureEvent).toHaveBeenCalledWith('user-1', 'subscription_resumed', { source: 'user' });
  });

  it('is idempotent: an unpaused subscription is returned without an update', async () => {
    signedInWith(subscription());

    const res = await resume();

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ success: true, alreadyActive: true });
    expect(mocks.subscriptionsUpdate).not.toHaveBeenCalled();
    expect(mocks.captureEvent).not.toHaveBeenCalled();
  });
});

describe('POST /api/subscription/discount', () => {
  it('applies the existing save50-2mo coupon, turns renewal back on, and captures the offer', async () => {
    signedInWith(subscription({ cancel_at_period_end: true }));

    const res = await discount();

    expect(res.status).toBe(200);
    expect(mocks.couponsRetrieve).toHaveBeenCalledWith('save50-2mo');
    expect(mocks.couponsCreate).not.toHaveBeenCalled();
    expect(mocks.subscriptionsUpdate).toHaveBeenCalledWith('sub_1', {
      discounts: [{ coupon: 'save50-2mo' }],
      cancel_at_period_end: false,
    });
    await expect(res.json()).resolves.toMatchObject({
      success: true,
      coupon: { id: 'save50-2mo', percent_off: 50, duration_in_months: 2 },
    });
    expect(mocks.captureEvent).toHaveBeenCalledWith('user-1', 'cancel_offer_accepted', { offer: 'discount' });
  });

  it('creates the coupon by fixed id when Stripe does not have it yet', async () => {
    signedInWith(subscription());
    mocks.couponsRetrieve.mockRejectedValue(stripeError('resource_missing'));
    mocks.couponsCreate.mockResolvedValue({ id: 'save50-2mo', percent_off: 50, duration_in_months: 2 });

    const res = await discount();

    expect(res.status).toBe(200);
    expect(mocks.couponsCreate).toHaveBeenCalledWith({
      id: 'save50-2mo',
      name: '50% off for 2 months',
      percent_off: 50,
      duration: 'repeating',
      duration_in_months: 2,
    });
    expect(mocks.subscriptionsUpdate).toHaveBeenCalledWith('sub_1', expect.objectContaining({
      discounts: [{ coupon: 'save50-2mo' }],
    }));
  });

  it('survives losing the create race (another request made the coupon first)', async () => {
    signedInWith(subscription());
    mocks.couponsRetrieve
      .mockRejectedValueOnce(stripeError('resource_missing'))
      .mockResolvedValueOnce({ id: 'save50-2mo', percent_off: 50, duration_in_months: 2 });
    mocks.couponsCreate.mockRejectedValue(stripeError('resource_already_exists'));

    const res = await discount();

    expect(res.status).toBe(200);
    expect(mocks.couponsRetrieve).toHaveBeenCalledTimes(2);
  });

  it('refuses a second application: any existing discount is a 409 with no Stripe write', async () => {
    signedInWith(subscription({ discounts: [{ id: 'di_1', coupon: { id: 'save50-2mo' } }] }));

    const res = await discount();

    expect(res.status).toBe(409);
    expect(mocks.couponsRetrieve).not.toHaveBeenCalled();
    expect(mocks.subscriptionsUpdate).not.toHaveBeenCalled();
    expect(mocks.captureEvent).not.toHaveBeenCalled();
  });

  it('also refuses while collection is paused (the discount would be voided)', async () => {
    signedInWith(subscription({ pause_collection: { behavior: 'void', resumes_at: 1_705_000_000 } }));

    const res = await discount();

    expect(res.status).toBe(409);
    expect(mocks.subscriptionsUpdate).not.toHaveBeenCalled();
  });

  it('returns 500 JSON when the coupon cannot be created for another reason', async () => {
    signedInWith(subscription());
    mocks.couponsRetrieve.mockRejectedValue(stripeError('api_key_expired'));

    const res = await discount();

    expect(res.status).toBe(500);
    expect(mocks.subscriptionsUpdate).not.toHaveBeenCalled();
  });
});

describe('POST /api/cancel-subscription', () => {
  it('requires one of Stripe\'s feedback values before looking anything up', async () => {
    for (const body of [{}, { feedback: 'bugs' }, { feedback: '' }]) {
      const res = await cancel(post(body));
      expect(res.status).toBe(400);
    }
    const res = await cancel(post('nope'));
    expect(res.status).toBe(400);
    expect(mocks.getUser).not.toHaveBeenCalled();
  });

  it('turns renewal off at period end with the reason and trimmed comment, and captures the confirmation', async () => {
    signedInWith(subscription());

    const res = await cancel(post({ feedback: 'unused', comment: '  never got round to it  ' }));

    expect(res.status).toBe(200);
    expect(mocks.subscriptionsUpdate).toHaveBeenCalledWith('sub_1', {
      cancel_at_period_end: true,
      cancellation_details: { feedback: 'unused', comment: 'never got round to it' },
    });
    await expect(res.json()).resolves.toMatchObject({
      success: true,
      alreadyCanceled: false,
      subscription: { id: 'sub_1', cancel_at_period_end: true, current_period_end: 1_702_592_000 },
    });
    expect(mocks.captureEvent).toHaveBeenCalledWith('user-1', 'subscription_cancel_confirmed', {
      feedback: 'unused',
      has_comment: true,
    });
  });

  it('omits an empty comment from cancellation_details', async () => {
    signedInWith(subscription());

    await cancel(post({ feedback: 'too_expensive', comment: '   ' }));

    expect(mocks.subscriptionsUpdate).toHaveBeenCalledWith('sub_1', {
      cancel_at_period_end: true,
      cancellation_details: { feedback: 'too_expensive' },
    });
    expect(mocks.captureEvent).toHaveBeenCalledWith('user-1', 'subscription_cancel_confirmed', {
      feedback: 'too_expensive',
      has_comment: false,
    });
  });

  it('is idempotent: renewal already off is returned without another update', async () => {
    signedInWith(subscription({ cancel_at_period_end: true }));

    const res = await cancel(post({ feedback: 'other' }));

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ success: true, alreadyCanceled: true });
    expect(mocks.subscriptionsUpdate).not.toHaveBeenCalled();
    expect(mocks.captureEvent).not.toHaveBeenCalled();
  });
});
