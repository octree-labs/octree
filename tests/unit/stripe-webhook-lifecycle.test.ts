import { describe, it, expect } from 'vitest';

import { checkoutAttributionFromMetadata, describeCheckoutSessionPlan, subscriptionLifecycleEvents } from '@/lib/stripe-webhook';

/**
 * Which PostHog churn/recovery events a `customer.subscription.*` webhook
 * produces (lib/stripe-webhook.ts). The route sends whatever this returns.
 */

function event(
  type: string,
  object: Record<string, unknown>,
  previous_attributes?: Record<string, unknown>
) {
  return {
    type,
    data: {
      object: { id: 'sub_1', status: 'active', cancel_at_period_end: false, ...object } as any,
      previous_attributes: previous_attributes as any,
    },
  };
}

describe('subscriptionLifecycleEvents', () => {
  it('reports a Pro onboarding when a subscription is created active', () => {
    expect(subscriptionLifecycleEvents(event('customer.subscription.created', {}))).toEqual([
      { event: 'onboarding_completed', properties: { plan: 'pro' } },
    ]);
    expect(
      subscriptionLifecycleEvents(event('customer.subscription.created', { status: 'incomplete' }))
    ).toEqual([]);
  });

  it('attributes the Pro onboarding to the checkout that started it (subscription metadata)', () => {
    expect(
      subscriptionLifecycleEvents(
        event('customer.subscription.created', {
          metadata: { user_id: 'u1', plan: 'annual', source: 'paywall', entry: 'onboarding' },
        })
      )
    ).toEqual([
      {
        event: 'onboarding_completed',
        properties: { plan: 'pro', checkout_plan: 'annual', source: 'paywall', entry: 'onboarding' },
      },
    ]);
    // Older subscriptions, or hand-edited metadata, add nothing.
    expect(
      subscriptionLifecycleEvents(
        event('customer.subscription.created', { metadata: { user_id: 'u1', plan: 'credits_100', source: 'nope' } })
      )
    ).toEqual([{ event: 'onboarding_completed', properties: { plan: 'pro' } }]);
  });

  it('reports a deleted subscription as a cancellation', () => {
    expect(
      subscriptionLifecycleEvents(event('customer.subscription.deleted', { status: 'canceled' }))
    ).toEqual([{ event: 'subscription_canceled', properties: { kind: 'deleted', status: 'canceled' } }]);
  });

  it('reports turning renewal off as a cancellation at period end, and back on as a reactivation', () => {
    expect(
      subscriptionLifecycleEvents(
        event('customer.subscription.updated', { cancel_at_period_end: true }, { cancel_at_period_end: false })
      )
    ).toEqual([{ event: 'subscription_canceled', properties: { kind: 'at_period_end', status: 'active' } }]);

    expect(
      subscriptionLifecycleEvents(
        event('customer.subscription.updated', { cancel_at_period_end: false }, { cancel_at_period_end: true })
      )
    ).toEqual([
      { event: 'subscription_reactivated', properties: { previous_status: 'active', status: 'active' } },
    ]);
  });

  it('reports past_due and the recovery from it', () => {
    expect(
      subscriptionLifecycleEvents(
        event('customer.subscription.updated', { status: 'past_due' }, { status: 'active' })
      )
    ).toEqual([{ event: 'subscription_past_due', properties: { status: 'past_due' } }]);

    expect(
      subscriptionLifecycleEvents(
        event('customer.subscription.updated', { status: 'active' }, { status: 'past_due' })
      )
    ).toEqual([
      { event: 'subscription_reactivated', properties: { previous_status: 'past_due', status: 'active' } },
    ]);
  });

  it('ignores updates that change nothing the funnel cares about', () => {
    expect(
      subscriptionLifecycleEvents(
        event('customer.subscription.updated', {}, { current_period_end: 1 })
      )
    ).toEqual([]);
    expect(subscriptionLifecycleEvents(event('customer.subscription.updated', {}))).toEqual([]);
  });
});

describe('checkoutAttributionFromMetadata', () => {
  it('returns only the known values', () => {
    expect(checkoutAttributionFromMetadata({ source: 'buy', entry: 'direct' })).toEqual({ source: 'buy', entry: 'direct' });
    expect(checkoutAttributionFromMetadata({ source: 'toolbar' })).toEqual({ source: 'toolbar' });
    expect(checkoutAttributionFromMetadata({ source: 'x', entry: 'y' })).toEqual({});
    expect(checkoutAttributionFromMetadata(null)).toEqual({});
  });
});

describe('describeCheckoutSessionPlan', () => {
  const session = (metadata: Record<string, string>) =>
    ({ id: 'cs_1', amount_total: 999, currency: 'usd', metadata }) as any;

  it('adds the checkout attribution to subscription_started', async () => {
    const stripe = {
      checkout: {
        sessions: {
          listLineItems: async () => ({
            data: [{ price: { id: 'price_1', lookup_key: 'octree_pro_monthly', recurring: { interval: 'month' } } }],
          }),
        },
      },
    } as any;
    expect(await describeCheckoutSessionPlan(stripe, session({ user_id: 'u1', plan: 'monthly', source: 'settings' }))).toEqual({
      plan: 'monthly',
      interval: 'month',
      amount: 9.99,
      currency: 'USD',
      source: 'settings',
    });
  });

  it('falls back to the plan the session was created with when the line item cannot be read', async () => {
    const stripe = { checkout: { sessions: { listLineItems: async () => { throw new Error('stripe'); } } } } as any;
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      expect(await describeCheckoutSessionPlan(stripe, session({ user_id: 'u1', plan: 'semester', source: 'buy', entry: 'dashboard' }))).toEqual({
        plan: 'semester',
        interval: 'unknown',
        amount: 9.99,
        currency: 'USD',
        source: 'buy',
        entry: 'dashboard',
      });
      expect(await describeCheckoutSessionPlan(stripe, session({ user_id: 'u1', plan: 'credits_100' }))).toMatchObject({ plan: 'unknown' });
    } finally {
      spy.mockRestore();
    }
  });
});
