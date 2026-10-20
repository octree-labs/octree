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
}));

vi.mock('next/headers', () => ({
  headers: async () => new Headers({ origin: 'https://app.example.com' }),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { getUser: mocks.getUser } }),
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
