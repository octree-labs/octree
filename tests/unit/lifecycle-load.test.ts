import { describe, it, expect } from 'vitest';

import {
  attachStripeLapses,
  isRetryable,
  MAX_SEND_ATTEMPTS,
  MAX_STRIPE_PAGES,
  subscriptionEndedAt,
  type LifecycleRows,
} from '@/lib/lifecycle/load';
import type { LifecycleUserRow } from '@/lib/lifecycle/select';

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

describe('isRetryable', () => {
  const row = (over: Partial<Parameters<typeof isRetryable>[0]>) =>
    ({ userId: 'u', template: 'welcome', resendId: null, error: null, attempts: 1, ...over });

  it('retries a failed send until the attempt cap', () => {
    expect(isRetryable(row({ error: 'boom' }))).toBe(true);
    expect(isRetryable(row({ error: 'boom', attempts: MAX_SEND_ATTEMPTS - 1 }))).toBe(true);
    expect(isRetryable(row({ error: 'boom', attempts: MAX_SEND_ATTEMPTS }))).toBe(false);
  });

  it('never retries a sent or in-flight row', () => {
    expect(isRetryable(row({ resendId: 'msg' }))).toBe(false);
    expect(isRetryable(row({ resendId: 'msg', error: 'late' }))).toBe(false);
    expect(isRetryable(row({}))).toBe(false);
  });
});

describe('attachStripeLapses', () => {
  const lapsedUser = (userId: string, customer: string, over: Partial<LifecycleUserRow> = {}): LifecycleUserRow => ({
    userId,
    email: `${userId}@example.com`,
    createdAt: '2026-01-01T00:00:00Z',
    editCount: 0,
    dailyResetDate: null,
    isPro: false,
    subscriptionStatus: 'canceled',
    stripeCustomerId: customer,
    role: null,
    firstProjectAt: null,
    subscriptionEndedAt: null,
    ...over,
  });

  function fakeStripe(pages: Array<Array<{ id: string; customer: string; status: string; ended_at?: number | null }>>) {
    const list = vi.fn(async ({ starting_after }: { starting_after?: string }) => {
      const index = starting_after ? pages.findIndex((page) => page[page.length - 1].id === starting_after) + 1 : 0;
      const data = (pages[index] ?? []).map((sub) => ({ canceled_at: null, ended_at: null, ...sub }));
      return { data, has_more: index < pages.length - 1 };
    });
    return { stripe: { subscriptions: { list } } as any, list };
  }

  function rows(users: LifecycleUserRow[], over: Partial<LifecycleRows> = {}): LifecycleRows {
    return { users, suppressedEmails: [], optedOutUserIds: [], sent: [], missingTables: [], ...over };
  }

  it('reads the whole account once, grouped by customer, not once per candidate', async () => {
    const users = Array.from({ length: 5 }, (_, i) => lapsedUser(`u${i}`, `cus_${i}`));
    const { stripe, list } = fakeStripe([
      [
        { id: 'sub_a', customer: 'cus_0', status: 'canceled', ended_at: 1_700_000_000 },
        { id: 'sub_b', customer: 'cus_1', status: 'active' },
        { id: 'sub_c', customer: 'cus_other', status: 'canceled', ended_at: 1_700_000_000 },
      ],
      [{ id: 'sub_d', customer: 'cus_2', status: 'incomplete_expired', ended_at: 1_700_000_000 }],
    ]);
    const result = await attachStripeLapses(stripe, rows(users));
    expect(result).toEqual({ candidates: 5, stripe_requests: 2, truncated: false });
    expect(list).toHaveBeenCalledTimes(2);
    expect(list.mock.calls[0][0]).toMatchObject({ status: 'all', limit: 100 });
    expect(list.mock.calls[1][0]).toMatchObject({ starting_after: 'sub_c' });
    expect(users[0].subscriptionEndedAt).toBe(new Date(1_700_000_000 * 1000).toISOString());
    expect(users[1].subscriptionEndedAt).toBeNull(); // still active in Stripe
    expect(users[2].subscriptionEndedAt).toBeNull(); // never paid
    expect(users[3].subscriptionEndedAt).toBeNull(); // no subscriptions at all
  });

  it('makes no Stripe request when nobody needs a lookup', async () => {
    const sentUser = lapsedUser('u1', 'cus_1');
    const optedOut = lapsedUser('u2', 'cus_2');
    const suppressed = lapsedUser('u3', 'cus_3', { email: 'Quiet@Example.com' });
    const paying = lapsedUser('u4', 'cus_4', { subscriptionStatus: 'paused' });
    const { stripe, list } = fakeStripe([[{ id: 'sub_a', customer: 'cus_1', status: 'canceled', ended_at: 1 }]]);
    const result = await attachStripeLapses(
      stripe,
      rows([sentUser, optedOut, suppressed, paying], {
        sent: [{ userId: 'u1', template: 'winback' }],
        optedOutUserIds: ['u2'],
        suppressedEmails: ['quiet@example.com'],
      })
    );
    expect(result).toEqual({ candidates: 0, stripe_requests: 0, truncated: false });
    expect(list).not.toHaveBeenCalled();
  });

  it('stops at the page cap and then marks nobody as lapsed', async () => {
    const users = [lapsedUser('u1', 'cus_1')];
    const list = vi.fn(async () => ({
      data: [{ id: 'sub_x', customer: 'cus_1', status: 'canceled', ended_at: 1_700_000_000, canceled_at: null }],
      has_more: true,
    }));
    const result = await attachStripeLapses({ subscriptions: { list } } as any, rows(users));
    expect(result).toEqual({ candidates: 1, stripe_requests: MAX_STRIPE_PAGES, truncated: true });
    expect(users[0].subscriptionEndedAt).toBeNull();
  });
});
