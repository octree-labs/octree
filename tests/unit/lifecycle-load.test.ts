import { describe, it, expect } from 'vitest';

import { subscriptionEndedAt } from '@/lib/lifecycle/load';

const sub = (status: string, ended: number | null, canceled: number | null = null) =>
  ({ status, ended_at: ended, canceled_at: canceled }) as any;

describe('subscriptionEndedAt', () => {
  it('is null while any subscription is still live', () => {
    expect(subscriptionEndedAt([sub('canceled', 1_700_000_000), sub('active', null)])).toBeNull();
    expect(subscriptionEndedAt([sub('trialing', null)])).toBeNull();
    expect(subscriptionEndedAt([sub('past_due', null)])).toBeNull();
  });

  it('takes the latest end across ended subscriptions, falling back to canceled_at', () => {
    expect(subscriptionEndedAt([sub('canceled', 1_700_000_000), sub('canceled', 1_710_000_000)])).toBe(
      new Date(1_710_000_000 * 1000).toISOString()
    );
    expect(subscriptionEndedAt([sub('canceled', null, 1_690_000_000)])).toBe(new Date(1_690_000_000 * 1000).toISOString());
  });

  it('is null for a customer who never had a paid subscription', () => {
    expect(subscriptionEndedAt([])).toBeNull();
    expect(subscriptionEndedAt([sub('incomplete', null)])).toBeNull();
    // An expired checkout has ended_at set but never ran.
    expect(subscriptionEndedAt([sub('incomplete_expired', 1_700_000_000)])).toBeNull();
    expect(subscriptionEndedAt([sub('incomplete_expired', 1_720_000_000), sub('canceled', 1_700_000_000)])).toBe(
      new Date(1_700_000_000 * 1000).toISOString()
    );
  });
});
