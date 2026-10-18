import { describe, it, expect } from 'vitest';

import { subscriptionLifecycleEvents } from '@/lib/stripe-webhook';

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
