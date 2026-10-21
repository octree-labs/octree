import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * app/api/checkout-session: `checkout_started` is captured server side, for
 * the signed-in user, once Stripe has opened the session, so a browser that
 * blocks analytics scripts still counts. Stripe, Supabase and PostHog are
 * mocked.
 */

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  sessionsCreate: vi.fn(),
  getOrCreatePrice: vi.fn(),
  resolveStripeCustomer: vi.fn(),
  captureEvent: vi.fn(),
  captureException: vi.fn(),
  ensureOfferPromotionCode: vi.fn(),
  // The export_single ownership read: from('projects').select().eq().eq().maybeSingle().
  projectMaybeSingle: vi.fn(),
  projectEq: vi.fn(),
  from: vi.fn(),
}));

vi.mock('@/lib/checkout-offers-stripe', () => ({
  ensureOfferPromotionCode: mocks.ensureOfferPromotionCode,
}));

vi.mock('next/headers', () => ({
  headers: async () => new Headers({ origin: 'https://app.example.com' }),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { getUser: mocks.getUser }, from: mocks.from }),
}));

vi.mock('@/lib/stripe', () => ({
  stripe: { checkout: { sessions: { create: mocks.sessionsCreate } } },
}));

vi.mock('@/lib/stripe-prices', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/stripe-prices')>()),
  getOrCreatePrice: mocks.getOrCreatePrice,
}));

vi.mock('@/lib/stripe-customer', () => ({
  resolveStripeCustomer: mocks.resolveStripeCustomer,
}));

vi.mock('@/lib/posthog-server', () => ({
  captureServerEventAfterResponse: mocks.captureEvent,
  captureServerExceptionAfterResponse: mocks.captureException,
}));

import { POST } from '@/app/api/checkout-session/route';

const user = { id: 'user-1', email: 'payer@example.com' };

function post(body: unknown) {
  return new Request('http://localhost/api/checkout-session', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

describe('POST /api/checkout-session analytics', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getUser.mockResolvedValue({ data: { user }, error: null });
    mocks.getOrCreatePrice.mockResolvedValue('price_123');
    mocks.resolveStripeCustomer.mockResolvedValue({ customerId: 'cus_1' });
    mocks.sessionsCreate.mockResolvedValue({ id: 'cs_test_1', url: 'https://checkout.stripe.com/c/cs_test_1' });
    mocks.ensureOfferPromotionCode.mockResolvedValue('promo_welcome');
  });

  it('captures checkout_started for the user with the plan, source and session', async () => {
    const response = await POST(post({ plan: 'monthly', source: 'toolbar', withTrial: true }));

    expect(response.status).toBe(200);
    expect(await response.text()).toBe('https://checkout.stripe.com/c/cs_test_1');
    expect(mocks.captureEvent).toHaveBeenCalledTimes(1);
    expect(mocks.captureEvent).toHaveBeenCalledWith('user-1', 'checkout_started', {
      plan: 'monthly',
      source: 'toolbar',
      entry: undefined,
      with_trial: true,
      mode: 'subscription',
      price_lookup_key: 'octree_pro_monthly',
      session_id: 'cs_test_1',
      captured: 'server',
    });
    // No offer asked for: Stripe is not asked about one and the session keeps the promo box.
    expect(mocks.ensureOfferPromotionCode).not.toHaveBeenCalled();
    const params = mocks.sessionsCreate.mock.calls[0][0];
    expect(params.allow_promotion_codes).toBe(true);
    expect(params.discounts).toBeUndefined();
    expect(params.metadata.offer).toBeUndefined();
  });

  it('reports one-off purchases as payment mode and keeps the /generate entry', async () => {
    await POST(post({ plan: 'generate_single', source: 'generate-preview', entry: 'onboarding' }));

    expect(mocks.captureEvent).toHaveBeenCalledWith(
      'user-1',
      'checkout_started',
      expect.objectContaining({
        plan: 'generate_single',
        source: 'generate-preview',
        entry: 'onboarding',
        with_trial: false,
        mode: 'payment',
        price_lookup_key: 'octree_generate_single',
      })
    );
  });

  it("reports source 'unknown' when the body sent none", async () => {
    await POST(post({ plan: 'credits_100' }));
    expect(mocks.captureEvent).toHaveBeenCalledWith(
      'user-1',
      'checkout_started',
      expect.objectContaining({ plan: 'credits_100', source: 'unknown', mode: 'payment' })
    );
  });

  it('captures nothing when the plan is refused or Stripe fails', async () => {
    const refused = await POST(post({ plan: 'weekly' }));
    expect(refused.status).toBe(400);

    mocks.sessionsCreate.mockRejectedValueOnce(new Error('stripe down'));
    const failed = await POST(post({ plan: 'monthly', source: 'settings' }));
    expect(failed.status).toBe(500);

    expect(mocks.captureEvent).not.toHaveBeenCalled();
    expect(mocks.captureException).toHaveBeenCalledTimes(1);
  });

  it('captures nothing for an anonymous request', async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: null });
    const response = await POST(post({ plan: 'monthly' }));
    expect(response.status).toBe(401);
    expect(mocks.captureEvent).not.toHaveBeenCalled();
  });
});

describe('POST /api/checkout-session offers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getUser.mockResolvedValue({ data: { user }, error: null });
    mocks.getOrCreatePrice.mockResolvedValue('price_123');
    mocks.resolveStripeCustomer.mockResolvedValue({ customerId: 'cus_1' });
    mocks.sessionsCreate.mockResolvedValue({ id: 'cs_test_1', url: 'https://checkout.stripe.com/c/cs_test_1' });
    mocks.ensureOfferPromotionCode.mockResolvedValue('promo_welcome');
  });

  it('applies a valid offer as a discount and records it', async () => {
    const response = await POST(post({ plan: 'monthly', source: 'buy', offer: 'welcome50' }));
    expect(response.status).toBe(200);
    expect(mocks.ensureOfferPromotionCode).toHaveBeenCalledWith('welcome50', expect.anything());
    expect(mocks.sessionsCreate).toHaveBeenCalledTimes(1);
    const params = mocks.sessionsCreate.mock.calls[0][0];
    expect(params.discounts).toEqual([{ promotion_code: 'promo_welcome' }]);
    // Stripe refuses both at once.
    expect(params).not.toHaveProperty('allow_promotion_codes');
    expect(params.metadata).toMatchObject({ offer: 'welcome50', plan: 'monthly', source: 'buy' });
    expect(params.subscription_data.metadata).toMatchObject({ offer: 'welcome50' });
    expect(mocks.captureEvent).toHaveBeenCalledWith(
      'user-1',
      'checkout_started',
      expect.objectContaining({ plan: 'monthly', offer: 'welcome50', offer_applied: true })
    );
  });

  it('refuses an unknown offer with a 400', async () => {
    const response = await POST(post({ plan: 'monthly', offer: 'free100' }));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'Unknown offer: free100' });
    expect(mocks.sessionsCreate).not.toHaveBeenCalled();
  });

  it('ignores an offer for a plan it does not cover (the credit pack)', async () => {
    const response = await POST(post({ plan: 'credits_100', offer: 'welcome50' }));
    expect(response.status).toBe(200);
    expect(mocks.ensureOfferPromotionCode).not.toHaveBeenCalled();
    const params = mocks.sessionsCreate.mock.calls[0][0];
    expect(params.discounts).toBeUndefined();
    expect(params.allow_promotion_codes).toBe(true);
    expect(mocks.captureEvent.mock.calls[0][2]).not.toHaveProperty('offer');
  });

  it('falls back to a full-price checkout when Stripe refuses the promotion code', async () => {
    const refused = Object.assign(new Error('This promotion code cannot be redeemed because it is only for first-time customers.'), {
      type: 'StripeInvalidRequestError',
      code: 'promotion_code_customer_not_first_time',
      statusCode: 400,
    });
    mocks.sessionsCreate.mockRejectedValueOnce(refused);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const response = await POST(post({ plan: 'monthly', source: 'buy', offer: 'welcome50' }));
    expect(response.status).toBe(200);
    expect(mocks.sessionsCreate).toHaveBeenCalledTimes(2);
    expect(mocks.sessionsCreate.mock.calls[0][0].discounts).toEqual([{ promotion_code: 'promo_welcome' }]);
    const retry = mocks.sessionsCreate.mock.calls[1][0];
    expect(retry.discounts).toBeUndefined();
    expect(retry.allow_promotion_codes).toBe(true);
    expect(retry.metadata.offer).toBeUndefined();
    expect(warn).toHaveBeenCalled();
    expect(mocks.captureEvent).toHaveBeenCalledWith(
      'user-1',
      'checkout_started',
      expect.objectContaining({ plan: 'monthly', offer: undefined, offer_applied: false })
    );
    warn.mockRestore();
  });

  it('opens a plain checkout when the promotion code cannot be ensured', async () => {
    mocks.ensureOfferPromotionCode.mockResolvedValueOnce(null);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const response = await POST(post({ plan: 'monthly', offer: 'welcome50' }));
    expect(response.status).toBe(200);
    expect(mocks.sessionsCreate).toHaveBeenCalledTimes(1);
    expect(mocks.sessionsCreate.mock.calls[0][0].discounts).toBeUndefined();
    warn.mockRestore();
  });

  it.each(['annual', 'semester'] as const)('opens a plain %s checkout (no 400) when the offer is monthly only', async (plan) => {
    const response = await POST(post({ plan, source: 'buy', offer: 'welcome50' }));
    expect(response.status).toBe(200);
    expect(mocks.ensureOfferPromotionCode).not.toHaveBeenCalled();
    const params = mocks.sessionsCreate.mock.calls[0][0];
    expect(params.discounts).toBeUndefined();
    expect(params.allow_promotion_codes).toBe(true);
    expect(params.metadata.offer).toBeUndefined();
  });

  it.each([
    ['auth', { type: 'StripeAuthenticationError', statusCode: 401 }],
    ['rate limit', { type: 'StripeRateLimitError', statusCode: 429, code: 'rate_limit' }],
    ['permission', { type: 'StripePermissionError', statusCode: 403 }],
    ['api', { type: 'StripeAPIError', statusCode: 500 }],
  ])('does not retry without the discount on a Stripe %s error', async (_label, fields) => {
    mocks.sessionsCreate.mockRejectedValueOnce(Object.assign(new Error('nope'), fields));
    const response = await POST(post({ plan: 'monthly', offer: 'welcome50' }));
    expect(response.status).not.toBe(200);
    expect(mocks.sessionsCreate).toHaveBeenCalledTimes(1);
  });

  it('does not retry a non-Stripe-validation failure', async () => {
    mocks.sessionsCreate.mockRejectedValueOnce(new Error('stripe down'));
    const response = await POST(post({ plan: 'monthly', offer: 'welcome50' }));
    expect(response.status).toBe(500);
    expect(mocks.sessionsCreate).toHaveBeenCalledTimes(1);
  });
});

describe('POST /api/checkout-session export_single', () => {
  const projectId = '2f1c7d4e-8a9b-4c3d-9e2f-1a2b3c4d5e6f';

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getUser.mockResolvedValue({ data: { user }, error: null });
    mocks.getOrCreatePrice.mockResolvedValue('price_export');
    mocks.resolveStripeCustomer.mockResolvedValue(null);
    mocks.sessionsCreate.mockResolvedValue({ id: 'cs_export_1', url: 'https://checkout.stripe.com/c/cs_export_1' });
    mocks.ensureOfferPromotionCode.mockResolvedValue('promo_welcome');
    const chain = { eq: mocks.projectEq, maybeSingle: mocks.projectMaybeSingle };
    mocks.projectEq.mockReturnValue(chain);
    mocks.from.mockReturnValue({ select: () => chain });
    mocks.projectMaybeSingle.mockResolvedValue({ data: { id: projectId }, error: null });
  });

  it("checks the project is the user's, then opens a payment session that unlocks it", async () => {
    const response = await POST(post({ plan: 'export_single', projectId, source: 'paywall', offer: 'welcome50' }));

    expect(response.status).toBe(200);
    expect(await response.text()).toBe('https://checkout.stripe.com/c/cs_export_1');
    expect(mocks.from).toHaveBeenCalledWith('projects');
    expect(mocks.projectEq).toHaveBeenCalledWith('id', projectId);
    expect(mocks.projectEq).toHaveBeenCalledWith('user_id', 'user-1');
    expect(mocks.getOrCreatePrice).toHaveBeenCalledWith('octree_export_single', expect.anything());
    // The offer is dropped: no promotion code lookup, no discount.
    expect(mocks.ensureOfferPromotionCode).not.toHaveBeenCalled();

    const params = mocks.sessionsCreate.mock.calls[0][0];
    expect(params.mode).toBe('payment');
    expect(params.discounts).toBeUndefined();
    expect(params.metadata).toEqual({
      user_id: 'user-1',
      plan: 'export_single',
      source: 'paywall',
      export_project_id: projectId,
    });
    expect(params.payment_intent_data.metadata).toEqual(params.metadata);
    expect(params.success_url).toBe(`https://app.example.com/projects/${projectId}?export=unlocked`);
    expect(params.cancel_url).toBe(`https://app.example.com/projects/${projectId}`);
    expect(params.customer_creation).toBe('always');

    expect(mocks.captureEvent).toHaveBeenCalledWith(
      'user-1',
      'checkout_started',
      expect.objectContaining({ plan: 'export_single', mode: 'payment', price_lookup_key: 'octree_export_single' })
    );
    expect(mocks.captureEvent.mock.calls[0][2]).not.toHaveProperty('offer');
  });

  it("returns 404 for someone else's project (RLS / user_id filter finds no row) and opens no session", async () => {
    mocks.projectMaybeSingle.mockResolvedValue({ data: null, error: null });

    const response = await POST(post({ plan: 'export_single', projectId, source: 'paywall' }));

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'Project not found' });
    expect(mocks.sessionsCreate).not.toHaveBeenCalled();
    expect(mocks.captureEvent).not.toHaveBeenCalled();
  });

  it('returns 400 without a valid projectId, before any query', async () => {
    for (const body of [{ plan: 'export_single' }, { plan: 'export_single', projectId: 'abc' }]) {
      const response = await POST(post(body));
      expect(response.status).toBe(400);
    }
    expect(mocks.from).not.toHaveBeenCalled();
    expect(mocks.sessionsCreate).not.toHaveBeenCalled();
  });

  it('returns 401 for an anonymous request', async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: null });
    const response = await POST(post({ plan: 'export_single', projectId }));
    expect(response.status).toBe(401);
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it('fails (500) when the ownership read errors, without opening a session', async () => {
    mocks.projectMaybeSingle.mockResolvedValue({ data: null, error: { message: 'db down' } });
    const response = await POST(post({ plan: 'export_single', projectId }));
    expect(response.status).toBe(500);
    expect(mocks.sessionsCreate).not.toHaveBeenCalled();
  });

  it('never queries projects for other plans, even with a projectId in the body', async () => {
    mocks.sessionsCreate.mockResolvedValue({ id: 'cs_test_1', url: 'https://checkout.stripe.com/c/cs_test_1' });
    const response = await POST(post({ plan: 'monthly', projectId }));
    expect(response.status).toBe(200);
    expect(mocks.from).not.toHaveBeenCalled();
    expect(mocks.sessionsCreate.mock.calls[0][0].metadata).not.toHaveProperty('export_project_id');
  });
});
