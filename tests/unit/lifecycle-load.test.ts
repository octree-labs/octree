import { describe, it, expect } from 'vitest';

import {
  attachStripeLapses,
  isRetryable,
  loadLifecycleRows,
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
        sent: [{ userId: 'u1', template: 'winback', ref: '' }],
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

describe('loadLifecycleRows', () => {
  /**
   * A Supabase stand-in: `from(table)` answers with the table's rows on
   * `.range()` whatever the chain before it, and the admin API lists the
   * given auth users. Enough to see what the loader derives per user.
   */
  function fakeDb(tables: Record<string, Array<Record<string, unknown>>>, authUsers: Array<{ id: string; email: string; created_at: string }>) {
    const from = vi.fn((table: string) => {
      const rows = tables[table];
      const chain: any = {};
      for (const method of ['select', 'eq', 'gte', 'order']) chain[method] = () => chain;
      chain.range = async (fromIndex: number, toIndex: number) => {
        if (!rows) return { data: null, error: { message: `relation "${table}" does not exist`, code: '42P01' } };
        return { data: rows.slice(fromIndex, toIndex + 1), error: null };
      };
      return chain;
    });
    return {
      from,
      auth: { admin: { listUsers: async () => ({ data: { users: authUsers }, error: null }) } },
    } as any;
  }

  it('dates a Pro user\'s activity from user_usage.updated_at too, since the Pro edit counter never moves daily_reset_date', async () => {
    const db = fakeDb(
      {
        user_usage: [
          {
            user_id: 'pro',
            edit_count: 0,
            daily_reset_date: '2026-01-01',
            is_pro: true,
            subscription_status: 'active',
            stripe_customer_id: 'cus_1',
            stripe_subscription_id: 'sub_1',
            current_period_start: '2026-10-01T00:00:00+00:00',
            current_period_end: '2026-11-01T00:00:00+00:00',
            updated_at: '2026-10-17T09:00:00+00:00',
            role: null,
          },
        ],
        projects: [{ user_id: 'pro', created_at: '2026-09-01T00:00:00+00:00', updated_at: '2026-09-20T00:00:00+00:00' }],
        generated_documents: [{ user_id: 'pro', created_at: '2026-10-05T00:00:00+00:00' }],
        email_suppressions: [],
        email_preferences: [],
        lifecycle_emails: [],
      },
      [{ id: 'pro', email: 'pro@example.com', created_at: '2026-08-01T00:00:00Z' }]
    );
    const rows = await loadLifecycleRows(db);
    expect(rows.missingTables).toEqual([]);
    expect(rows.users).toHaveLength(1);
    expect(rows.users[0]).toMatchObject({
      userId: 'pro',
      stripeSubscriptionId: 'sub_1',
      currentPeriodStart: '2026-10-01T00:00:00+00:00',
      currentPeriodEnd: '2026-11-01T00:00:00+00:00',
      lastActivityAt: '2026-10-17T09:00:00+00:00',
    });
  });

  it('takes the latest of project saves, generations and the usage row, and null when there is none', async () => {
    const db = fakeDb(
      {
        user_usage: [
          { user_id: 'a', edit_count: 0, daily_reset_date: '2026-10-02', is_pro: false, subscription_status: 'inactive', stripe_customer_id: null, stripe_subscription_id: null, current_period_start: null, current_period_end: null, updated_at: '2026-10-02T00:00:00+00:00', role: null },
        ],
        projects: [{ user_id: 'a', created_at: '2026-10-01T00:00:00+00:00', updated_at: '2026-10-09T12:00:00+00:00' }],
        generated_documents: [{ user_id: 'a', created_at: '2026-10-04T00:00:00+00:00' }],
        email_suppressions: [],
        email_preferences: [],
        lifecycle_emails: [],
      },
      [
        { id: 'a', email: 'a@example.com', created_at: '2026-08-01T00:00:00Z' },
        { id: 'b', email: 'b@example.com', created_at: '2026-08-01T00:00:00Z' },
      ]
    );
    const rows = await loadLifecycleRows(db);
    expect(rows.users.find((u) => u.userId === 'a')?.lastActivityAt).toBe('2026-10-09T12:00:00+00:00');
    expect(rows.users.find((u) => u.userId === 'b')?.lastActivityAt).toBeNull();
    expect(rows.users.find((u) => u.userId === 'b')?.currentPeriodStart).toBeNull();
  });

  const baseTables = () => ({
    user_usage: [
      { user_id: 'a', edit_count: 0, daily_reset_date: null, is_pro: false, subscription_status: 'inactive', stripe_customer_id: null, stripe_subscription_id: null, current_period_start: null, current_period_end: null, updated_at: null, role: null },
    ],
    projects: [],
    generated_documents: [],
    email_suppressions: [],
    email_preferences: [],
    lifecycle_emails: [],
  });
  const authUsers = [
    { id: 'a', email: 'a@example.com', created_at: '2026-08-01T00:00:00Z' },
    { id: 'b', email: 'b@example.com', created_at: '2026-08-01T00:00:00Z' },
  ];

  it('attaches each user\'s latest paywall hit', async () => {
    const db = fakeDb(
      {
        ...baseTables(),
        paywall_hits: [
          { id: '1', user_id: 'a', feature: 'export', reason: 'pro_feature', created_at: '2026-10-19T10:00:00+00:00' },
          { id: '2', user_id: 'a', feature: 'ai-edit', reason: 'daily_limit', created_at: '2026-10-20T08:00:00+00:00' },
          { id: '3', user_id: 'a', feature: 'generate', reason: 'generate_quota', created_at: '2026-10-18T08:00:00+00:00' },
        ],
      },
      authUsers
    );
    const rows = await loadLifecycleRows(db, new Date('2026-10-21T14:30:00Z'));
    expect(rows.missingOptionalTables).toEqual([]);
    expect(rows.users.find((u) => u.userId === 'a')?.lastPaywallHit).toEqual({
      feature: 'ai-edit',
      reason: 'daily_limit',
      createdAt: '2026-10-20T08:00:00+00:00',
    });
    expect(rows.users.find((u) => u.userId === 'b')?.lastPaywallHit).toBeNull();
    expect(db.from).toHaveBeenCalledWith('paywall_hits');
  });

  it('tolerates a missing paywall_hits table without blocking the run', async () => {
    const db = fakeDb(baseTables(), authUsers);
    const rows = await loadLifecycleRows(db);
    // Not a ledger table: the live run still sends everything else.
    expect(rows.missingTables).toEqual([]);
    expect(rows.missingOptionalTables).toEqual(['paywall_hits']);
    expect(rows.users.every((u) => u.lastPaywallHit === null)).toBe(true);
  });
});
