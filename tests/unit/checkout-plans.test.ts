import { describe, it, expect } from 'vitest';

import {
  CHECKOUT_SESSION_MAX_TTL_SECONDS,
  CHECKOUT_SESSION_MIN_TTL_SECONDS,
  CHECKOUT_SESSION_TTL_SECONDS,
  EXPORT_PROJECT_REQUIRED_MESSAGE,
  WEEKLY_PLAN_RETIRED_MESSAGE,
  buildCheckoutSessionParams,
  lookupKeyForPlan,
  resolveCheckoutPlan,
} from '@/lib/checkout-plans';

describe('resolveCheckoutPlan', () => {
  it('accepts every plan the picker can send', () => {
    for (const plan of ['monthly', 'annual', 'semester', 'credits_100'] as const) {
      expect(resolveCheckoutPlan({ plan })).toEqual({ ok: true, plan, withTrial: false });
    }
  });

  it('keeps the legacy { annual: true } body buying the monthly plan', () => {
    expect(resolveCheckoutPlan({ annual: true, withTrial: true })).toEqual({
      ok: true,
      plan: 'monthly',
      withTrial: true,
    });
  });

  it('defaults an empty or unparseable body to monthly, not to the retired weekly plan', () => {
    expect(resolveCheckoutPlan({})).toEqual({ ok: true, plan: 'monthly', withTrial: false });
    expect(resolveCheckoutPlan(undefined)).toEqual({ ok: true, plan: 'monthly', withTrial: false });
    expect(resolveCheckoutPlan('garbage')).toEqual({ ok: true, plan: 'monthly', withTrial: false });
  });

  it('refuses the weekly plan for new purchases, by flag or by name', () => {
    expect(resolveCheckoutPlan({ annual: false })).toEqual({ ok: false, error: WEEKLY_PLAN_RETIRED_MESSAGE });
    expect(resolveCheckoutPlan({ plan: 'weekly' })).toEqual({ ok: false, error: WEEKLY_PLAN_RETIRED_MESSAGE });
  });

  it('prefers plan over the legacy flag when both are present', () => {
    expect(resolveCheckoutPlan({ plan: 'annual', annual: false })).toEqual({
      ok: true,
      plan: 'annual',
      withTrial: false,
    });
  });

  it('rejects unknown plans', () => {
    expect(resolveCheckoutPlan({ plan: 'lifetime' })).toEqual({ ok: false, error: 'Unknown plan: lifetime' });
    expect(resolveCheckoutPlan({ plan: 42 })).toMatchObject({ ok: false });
  });

  it('carries a known source and entry through, and drops anything else without failing', () => {
    expect(resolveCheckoutPlan({ plan: 'monthly', source: 'paywall', entry: 'onboarding' })).toEqual({
      ok: true,
      plan: 'monthly',
      withTrial: false,
      source: 'paywall',
      entry: 'onboarding',
    });
    expect(resolveCheckoutPlan({ plan: 'monthly', source: 'buy' })).toEqual({ ok: true, plan: 'monthly', withTrial: false, source: 'buy' });
    expect(resolveCheckoutPlan({ annual: true, source: 'onboarding' })).toMatchObject({ ok: true, plan: 'monthly', source: 'onboarding' });
    expect(resolveCheckoutPlan({ plan: 'monthly', source: 'evil<script>', entry: 42 })).toEqual({
      ok: true,
      plan: 'monthly',
      withTrial: false,
    });
  });
});

describe('lookupKeyForPlan', () => {
  it('maps each plan to its Stripe lookup key', () => {
    expect(lookupKeyForPlan('monthly')).toBe('octree_pro_monthly');
    expect(lookupKeyForPlan('annual')).toBe('octree_pro_annual');
    expect(lookupKeyForPlan('semester')).toBe('octree_semester_pass');
    expect(lookupKeyForPlan('credits_100')).toBe('octree_credits_100');
  });
});

describe('buildCheckoutSessionParams', () => {
  const base = {
    priceId: 'price_123',
    userId: 'user-1',
    customerId: null,
    email: 'buyer@example.com',
    origin: 'https://app.example.com',
    withTrial: false,
  };

  it('opens a subscription session for a recurring plan with the user id on the subscription', () => {
    const params = buildCheckoutSessionParams({ ...base, plan: 'annual' });

    expect(params).toMatchObject({
      mode: 'subscription',
      line_items: [{ price: 'price_123', quantity: 1 }],
      success_url: 'https://app.example.com/success?session_id={CHECKOUT_SESSION_ID}',
      cancel_url: 'https://app.example.com/onboarding?canceled=true',
      automatic_tax: { enabled: true },
      allow_promotion_codes: true,
      locale: 'auto',
      customer_email: 'buyer@example.com',
      metadata: { user_id: 'user-1', plan: 'annual' },
      subscription_data: { metadata: { user_id: 'user-1', plan: 'annual' } },
    });
    expect(params).not.toHaveProperty('customer');
    expect(params.subscription_data).not.toHaveProperty('trial_period_days');
  });

  it('writes the attribution to the session, the subscription and the payment intent metadata', () => {
    const sub = buildCheckoutSessionParams({ ...base, plan: 'monthly', source: 'paywall', entry: 'dashboard' });
    expect(sub.metadata).toEqual({ user_id: 'user-1', plan: 'monthly', source: 'paywall', entry: 'dashboard' });
    expect(sub.subscription_data?.metadata).toEqual({ user_id: 'user-1', plan: 'monthly', source: 'paywall', entry: 'dashboard' });

    const credit = buildCheckoutSessionParams({ ...base, plan: 'generate_single', source: 'generate-preview' });
    expect(credit.metadata).toEqual({ user_id: 'user-1', plan: 'generate_single', generation_credits: '1', source: 'generate-preview' });
    expect(credit.payment_intent_data?.metadata).toEqual({ user_id: 'user-1', plan: 'generate_single', source: 'generate-preview' });

    // Without attribution the metadata is exactly what it was.
    expect(buildCheckoutSessionParams({ ...base, plan: 'monthly' }).metadata).toEqual({ user_id: 'user-1', plan: 'monthly' });
  });

  it('adds the 3-day trial only when asked', () => {
    const params = buildCheckoutSessionParams({ ...base, plan: 'monthly', withTrial: true });
    expect(params.subscription_data?.trial_period_days).toBe(3);
  });

  describe('abandoned-checkout recovery', () => {
    const now = 1_760_000_000;

    it.each(['monthly', 'annual', 'semester', 'credits_100', 'generate_single'] as const)(
      '%s expires just under 24h after creation, within Stripe bounds, with recovery enabled',
      (plan) => {
        const params = buildCheckoutSessionParams({ ...base, plan, nowSeconds: now });

        expect(params.expires_at).toBe(now + CHECKOUT_SESSION_TTL_SECONDS);
        expect(params.expires_at! - now).toBeGreaterThanOrEqual(CHECKOUT_SESSION_MIN_TTL_SECONDS);
        // Strictly under Stripe's 24h ceiling: an exact 24h is rejected as soon
        // as this server's clock runs ahead of Stripe's.
        expect(params.expires_at! - now).toBeLessThanOrEqual(CHECKOUT_SESSION_MAX_TTL_SECONDS - 60);
        expect(params.after_expiration).toEqual({ recovery: { enabled: true, allow_promotion_codes: true } });
        // The webhook keys the recovery email on these.
        expect(params.metadata).toMatchObject({ user_id: 'user-1', plan });
      }
    );

    it('defaults the expiry to the current time', () => {
      const before = Math.floor(Date.now() / 1000);
      const params = buildCheckoutSessionParams({ ...base, plan: 'monthly' });
      expect(params.expires_at).toBeGreaterThanOrEqual(before + CHECKOUT_SESSION_TTL_SECONDS);
      expect(params.expires_at).toBeLessThanOrEqual(before + CHECKOUT_SESSION_TTL_SECONDS + 5);
    });

    it('passes customer_email so Stripe can address the recovery email, unless the customer is known', () => {
      expect(buildCheckoutSessionParams({ ...base, plan: 'monthly' }).customer_email).toBe('buyer@example.com');
      expect(buildCheckoutSessionParams({ ...base, plan: 'monthly', customerId: 'cus_9' })).not.toHaveProperty(
        'customer_email'
      );
    });
  });

  it('uses the known Stripe customer instead of customer_email', () => {
    const params = buildCheckoutSessionParams({ ...base, plan: 'semester', customerId: 'cus_9' });

    expect(params.customer).toBe('cus_9');
    expect(params.customer_update).toEqual({ address: 'auto', name: 'auto' });
    expect(params).not.toHaveProperty('customer_email');
  });

  it('opens a one-time payment session for the credit pack with the credit count in metadata', () => {
    const params = buildCheckoutSessionParams({ ...base, plan: 'credits_100' });

    expect(params).toMatchObject({
      mode: 'payment',
      cancel_url: 'https://app.example.com/settings?canceled=true',
      metadata: { user_id: 'user-1', plan: 'credits_100', credits: '100' },
      payment_intent_data: { metadata: { user_id: 'user-1', plan: 'credits_100' } },
      customer_creation: 'always',
    });
    expect(params).not.toHaveProperty('subscription_data');
  });

  it('does not ask Checkout to create a customer when one is already known', () => {
    const params = buildCheckoutSessionParams({ ...base, plan: 'credits_100', customerId: 'cus_9' });
    expect(params).not.toHaveProperty('customer_creation');
    expect(params.customer).toBe('cus_9');
  });

  it('opens a one-time payment session for the single generation, back to /generate, with generation_credits metadata', () => {
    const params = buildCheckoutSessionParams({ ...base, plan: 'generate_single' });

    expect(params).toMatchObject({
      mode: 'payment',
      success_url: 'https://app.example.com/generate?purchased=1',
      cancel_url: 'https://app.example.com/generate',
      metadata: { user_id: 'user-1', plan: 'generate_single', generation_credits: '1' },
      payment_intent_data: { metadata: { user_id: 'user-1', plan: 'generate_single' } },
      customer_creation: 'always',
    });
    // Never the edit-credit key: the webhook grants the two products independently.
    expect(params.metadata).not.toHaveProperty('credits');
    expect(params).not.toHaveProperty('subscription_data');
  });

  it('accepts and maps the single generation plan', () => {
    expect(resolveCheckoutPlan({ plan: 'generate_single' })).toEqual({
      ok: true,
      plan: 'generate_single',
      withTrial: false,
    });
    expect(lookupKeyForPlan('generate_single')).toBe('octree_generate_single');
  });
});

describe('checkout offers', () => {
  it('keeps a known offer for the monthly plan', () => {
    expect(resolveCheckoutPlan({ plan: 'monthly', offer: 'welcome50' })).toMatchObject({ ok: true, plan: 'monthly', offer: 'welcome50' });
    expect(resolveCheckoutPlan({ offer: 'welcome50' })).toMatchObject({ ok: true, plan: 'monthly', offer: 'welcome50' });
  });

  it('drops an offer for annual, semester and the one-off purchases without failing', () => {
    for (const plan of ['annual', 'semester', 'credits_100', 'generate_single']) {
      const resolved = resolveCheckoutPlan({ plan, offer: 'welcome50' });
      expect(resolved.ok).toBe(true);
      expect(resolved).not.toHaveProperty('offer');
    }
  });

  it('refuses an unknown offer and treats empty values as none', () => {
    expect(resolveCheckoutPlan({ plan: 'monthly', offer: 'WELCOME50' })).toEqual({ ok: false, error: 'Unknown offer: WELCOME50' });
    expect(resolveCheckoutPlan({ plan: 'monthly', offer: 50 })).toMatchObject({ ok: false });
    expect(resolveCheckoutPlan({ plan: 'monthly', offer: null })).not.toHaveProperty('offer');
    expect(resolveCheckoutPlan({ plan: 'monthly', offer: '' })).not.toHaveProperty('offer');
    expect(resolveCheckoutPlan({ plan: 'monthly' })).not.toHaveProperty('offer');
  });

  const base = {
    priceId: 'price_123',
    userId: 'user-1',
    customerId: null,
    email: 'buyer@example.com',
    origin: 'https://app.example.com',
    withTrial: false,
    nowSeconds: 1_800_000_000,
  };

  it('swaps the promotion code box for the discount and tags the metadata', () => {
    const params = buildCheckoutSessionParams({ ...base, plan: 'monthly', offer: 'welcome50', promotionCodeId: 'promo_1' });
    expect(params.discounts).toEqual([{ promotion_code: 'promo_1' }]);
    expect(params).not.toHaveProperty('allow_promotion_codes');
    // Recovery stays on, without its own promotion code box next to the discount.
    expect(params.after_expiration).toEqual({ recovery: { enabled: true } });
    expect(params.metadata).toMatchObject({ offer: 'welcome50' });
    expect(params.subscription_data?.metadata).toMatchObject({ offer: 'welcome50' });
  });

  it('is unchanged without an offer or without its promotion code id', () => {
    const plain = buildCheckoutSessionParams({ ...base, plan: 'monthly' });
    expect(buildCheckoutSessionParams({ ...base, plan: 'monthly', offer: 'welcome50', promotionCodeId: null })).toEqual(plain);
    expect(plain.allow_promotion_codes).toBe(true);
    expect(plain.discounts).toBeUndefined();
  });
});

describe('export_single (one-off export unlock for one project)', () => {
  const projectId = '2f1c7d4e-8a9b-4c3d-9e2f-1a2b3c4d5e6f';
  const base = {
    priceId: 'price_export',
    userId: 'user-1',
    customerId: null,
    email: 'buyer@example.com',
    origin: 'https://app.example.com',
    withTrial: false,
    nowSeconds: 1_800_000_000,
  };

  it('requires a uuid projectId and carries it through', () => {
    expect(resolveCheckoutPlan({ plan: 'export_single', projectId, source: 'paywall' })).toEqual({
      ok: true,
      plan: 'export_single',
      withTrial: false,
      source: 'paywall',
      projectId,
    });
    for (const bad of [undefined, null, '', 'not-a-uuid', 42, `${projectId}x`]) {
      expect(resolveCheckoutPlan({ plan: 'export_single', projectId: bad })).toEqual({
        ok: false,
        error: EXPORT_PROJECT_REQUIRED_MESSAGE,
      });
    }
  });

  it('ignores projectId for every other plan', () => {
    for (const plan of ['monthly', 'annual', 'semester', 'credits_100', 'generate_single'] as const) {
      const resolved = resolveCheckoutPlan({ plan, projectId });
      expect(resolved).toEqual({ ok: true, plan, withTrial: false });
    }
  });

  it('drops the welcome50 offer silently (it is not a subscription)', () => {
    const resolved = resolveCheckoutPlan({ plan: 'export_single', projectId, offer: 'welcome50' });
    expect(resolved.ok).toBe(true);
    expect(resolved).not.toHaveProperty('offer');
  });

  it('maps to the octree_export_single lookup key', () => {
    expect(lookupKeyForPlan('export_single')).toBe('octree_export_single');
  });

  it('opens a one-time payment session that returns to the project', () => {
    const params = buildCheckoutSessionParams({ ...base, plan: 'export_single', projectId, source: 'paywall' });

    expect(params).toMatchObject({
      mode: 'payment',
      line_items: [{ price: 'price_export', quantity: 1 }],
      success_url: `https://app.example.com/projects/${projectId}?export=unlocked`,
      cancel_url: `https://app.example.com/projects/${projectId}`,
      customer_email: 'buyer@example.com',
      customer_creation: 'always',
      allow_promotion_codes: true,
      expires_at: base.nowSeconds + CHECKOUT_SESSION_TTL_SECONDS,
      after_expiration: { recovery: { enabled: true, allow_promotion_codes: true } },
    });
    const metadata = { user_id: 'user-1', plan: 'export_single', source: 'paywall', export_project_id: projectId };
    expect(params.metadata).toEqual(metadata);
    expect(params.payment_intent_data?.metadata).toEqual(metadata);
    // Neither one-off credit key: the webhook grants only the export unlock.
    expect(params.metadata).not.toHaveProperty('credits');
    expect(params.metadata).not.toHaveProperty('generation_credits');
    expect(params).not.toHaveProperty('subscription_data');
  });

  it('reuses a known customer', () => {
    const params = buildCheckoutSessionParams({ ...base, plan: 'export_single', projectId, customerId: 'cus_9' });
    expect(params.customer).toBe('cus_9');
    expect(params).not.toHaveProperty('customer_creation');
  });

  it('refuses to build a session without the project', () => {
    expect(() => buildCheckoutSessionParams({ ...base, plan: 'export_single' })).toThrow(EXPORT_PROJECT_REQUIRED_MESSAGE);
  });

  it('never writes export_project_id for other plans', () => {
    const params = buildCheckoutSessionParams({ ...base, plan: 'generate_single', projectId });
    expect(params.metadata).not.toHaveProperty('export_project_id');
    expect(params.success_url).toBe('https://app.example.com/generate?purchased=1');
  });
});
