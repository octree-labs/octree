import { describe, it, expect } from 'vitest';

import {
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

  it('adds the 3-day trial only when asked', () => {
    const params = buildCheckoutSessionParams({ ...base, plan: 'monthly', withTrial: true });
    expect(params.subscription_data?.trial_period_days).toBe(3);
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
