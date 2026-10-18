import { describe, it, expect } from 'vitest';

import {
  eligibleSince,
  isWinbackPrecandidate,
  selectLifecycleCandidates,
  type LifecycleUserRow,
} from '@/lib/lifecycle/select';
import { LIFECYCLE_TEMPLATES } from '@/lib/email/lifecycle';
import { enabledTemplates } from '@/lib/lifecycle/config';

// 14:30 UTC, the cron's scheduled time.
const NOW = new Date('2026-10-18T14:30:00Z');
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const ago = (msAgo: number) => new Date(NOW.getTime() - msAgo).toISOString();

let seq = 0;
function user(overrides: Partial<LifecycleUserRow> = {}): LifecycleUserRow {
  seq += 1;
  return {
    userId: `user-${seq}`,
    email: `user${seq}@example.com`,
    createdAt: ago(2 * DAY),
    editCount: 0,
    dailyResetDate: null,
    isPro: false,
    subscriptionStatus: 'inactive',
    stripeCustomerId: null,
    role: null,
    firstProjectAt: null,
    subscriptionEndedAt: null,
    ...overrides,
  };
}

function select(users: LifecycleUserRow[], extra: Partial<Parameters<typeof selectLifecycleCandidates>[0]> = {}) {
  return selectLifecycleCandidates({
    users,
    suppressedEmails: [],
    optedOutUserIds: [],
    sent: [],
    enabledTemplates: [...LIFECYCLE_TEMPLATES],
    now: NOW,
    ...extra,
  });
}

describe('welcome', () => {
  it('goes to accounts 1-3d old with no project (the Inngest welcome covers day 0)', () => {
    expect(eligibleSince(user({ createdAt: ago(2 * DAY) }), 'welcome', NOW)).not.toBeNull();
    expect(eligibleSince(user({ createdAt: ago(DAY) }), 'welcome', NOW)).not.toBeNull();
    expect(eligibleSince(user({ createdAt: ago(2 * HOUR) }), 'welcome', NOW)).toBeNull();
    expect(eligibleSince(user({ createdAt: ago(3 * DAY + HOUR) }), 'welcome', NOW)).toBeNull();
  });

  it('skips people who already made a project, subscribers and staff', () => {
    expect(eligibleSince(user({ firstProjectAt: ago(HOUR) }), 'welcome', NOW)).toBeNull();
    expect(eligibleSince(user({ isPro: true }), 'welcome', NOW)).toBeNull();
    expect(eligibleSince(user({ subscriptionStatus: 'active' }), 'welcome', NOW)).toBeNull();
    expect(eligibleSince(user({ role: 'unlimited' }), 'welcome', NOW)).toBeNull();
  });

  it('is dated one day after sign-up so the oldest sign-ups go first', () => {
    const created = ago(2 * DAY + 5 * HOUR);
    expect(eligibleSince(user({ createdAt: created }), 'welcome', NOW)).toBe(Date.parse(created) + DAY);
  });
});

describe('staff and subscription exclusions (every template)', () => {
  // Whitelists in lib/paywall.ts and lib/admin.ts.
  const whitelisted = 'rascodes123@gmail.com';
  const cases: Array<[string, Partial<LifecycleUserRow>]> = [
    ['edit whitelist email', { email: whitelisted }],
    ['edit whitelist email, any case', { email: whitelisted.toUpperCase() }],
    ['role admin', { role: 'admin' }],
    ['role unlimited', { role: 'unlimited' }],
    ['is_pro', { isPro: true }],
    ['status active', { subscriptionStatus: 'active' }],
    ['status trialing', { subscriptionStatus: 'trialing' }],
    ['status past_due (dunning)', { subscriptionStatus: 'past_due' }],
    ['status paused (cancel flow, PR #398)', { subscriptionStatus: 'paused' }],
    ['status unlimited', { subscriptionStatus: 'unlimited' }],
  ];

  it.each(cases)('%s never gets any lifecycle email', (_label, overrides) => {
    const base: Partial<LifecycleUserRow> = {
      createdAt: ago(8 * DAY),
      firstProjectAt: ago(7 * DAY),
      editCount: 5,
      dailyResetDate: ago(0),
      stripeCustomerId: 'cus_1',
      subscriptionEndedAt: ago(30 * DAY),
    };
    for (const template of LIFECYCLE_TEMPLATES) {
      expect(eligibleSince(user({ ...base, ...overrides }), template, NOW), template).toBeNull();
    }
    expect(isWinbackPrecandidate(user({ ...base, ...overrides }))).toBe(false);
  });

  it('a lapsed status (canceled, inactive, incomplete_expired) is not a subscription', () => {
    for (const status of ['canceled', 'inactive', 'incomplete_expired', null]) {
      expect(
        eligibleSince(user({ createdAt: ago(8 * DAY), firstProjectAt: ago(DAY), subscriptionStatus: status }), 'day7', NOW)
      ).not.toBeNull();
    }
  });
});

describe('limit_hit', () => {
  // daily_reset_date is a date: the day the free counter started.
  const today = '2026-10-18';
  const yesterday = '2026-10-17';
  const twoDaysAgo = '2026-10-16';

  it('needs the daily counter at the limit today or yesterday', () => {
    expect(eligibleSince(user({ editCount: 5, dailyResetDate: today }), 'limit_hit', NOW)).toBe(Date.parse(today));
    expect(eligibleSince(user({ editCount: 5, dailyResetDate: yesterday }), 'limit_hit', NOW)).not.toBeNull();
    expect(eligibleSince(user({ editCount: 5, dailyResetDate: twoDaysAgo }), 'limit_hit', NOW)).toBeNull();
    expect(eligibleSince(user({ editCount: 4, dailyResetDate: today }), 'limit_hit', NOW)).toBeNull();
    expect(eligibleSince(user({ editCount: 50, dailyResetDate: null }), 'limit_hit', NOW)).toBeNull();
    expect(eligibleSince(user({ editCount: 5, dailyResetDate: today, isPro: true }), 'limit_hit', NOW)).toBeNull();
  });

  it('does not depend on the account age', () => {
    expect(
      eligibleSince(user({ createdAt: ago(400 * DAY), editCount: 9, dailyResetDate: today }), 'limit_hit', NOW)
    ).not.toBeNull();
  });
});

describe('day7', () => {
  it('goes to free accounts 7-14 days old that have a project', () => {
    expect(eligibleSince(user({ createdAt: ago(7 * DAY), firstProjectAt: ago(6 * DAY) }), 'day7', NOW)).not.toBeNull();
    expect(eligibleSince(user({ createdAt: ago(6 * DAY), firstProjectAt: ago(6 * DAY) }), 'day7', NOW)).toBeNull();
    expect(eligibleSince(user({ createdAt: ago(15 * DAY), firstProjectAt: ago(6 * DAY) }), 'day7', NOW)).toBeNull();
    expect(eligibleSince(user({ createdAt: ago(8 * DAY) }), 'day7', NOW)).toBeNull();
    expect(eligibleSince(user({ createdAt: ago(8 * DAY), firstProjectAt: ago(DAY), isPro: true }), 'day7', NOW)).toBeNull();
  });
});

describe('winback', () => {
  const lapsed = () =>
    user({
      createdAt: ago(200 * DAY),
      stripeCustomerId: 'cus_1',
      subscriptionStatus: 'canceled',
      subscriptionEndedAt: ago(30 * DAY),
    });

  it('goes to former Stripe customers whose subscription ended at least 7 days ago', () => {
    expect(eligibleSince(lapsed(), 'winback', NOW)).not.toBeNull();
    expect(eligibleSince({ ...lapsed(), subscriptionEndedAt: ago(3 * DAY) }, 'winback', NOW)).toBeNull();
    expect(eligibleSince({ ...lapsed(), subscriptionEndedAt: null }, 'winback', NOW)).toBeNull();
    expect(eligibleSince({ ...lapsed(), stripeCustomerId: null }, 'winback', NOW)).toBeNull();
  });

  it('never goes to someone currently paying, in dunning or paused', () => {
    expect(eligibleSince({ ...lapsed(), isPro: true }, 'winback', NOW)).toBeNull();
    expect(eligibleSince({ ...lapsed(), subscriptionStatus: 'trialing' }, 'winback', NOW)).toBeNull();
    expect(eligibleSince({ ...lapsed(), subscriptionStatus: 'past_due' }, 'winback', NOW)).toBeNull();
    expect(eligibleSince({ ...lapsed(), subscriptionStatus: 'paused' }, 'winback', NOW)).toBeNull();
  });

  it('pre-filters the Stripe lookups to lapsed customers with an email', () => {
    expect(isWinbackPrecandidate(lapsed())).toBe(true);
    expect(isWinbackPrecandidate({ ...lapsed(), email: null })).toBe(false);
    expect(isWinbackPrecandidate({ ...lapsed(), isPro: true })).toBe(false);
    expect(isWinbackPrecandidate(user())).toBe(false);
  });

  it('is off unless LIFECYCLE_WINBACK_ENABLED=true', () => {
    expect(enabledTemplates({})).toEqual(new Set(['welcome', 'limit_hit', 'day7']));
    expect(enabledTemplates({ LIFECYCLE_WINBACK_ENABLED: 'false' }).has('winback')).toBe(false);
    expect(enabledTemplates({ LIFECYCLE_WINBACK_ENABLED: 'true' }).has('winback')).toBe(true);
  });

  it('is listed as eligible but not queued when disabled', () => {
    const selection = select([lapsed()], { enabledTemplates: ['welcome', 'limit_hit', 'day7'] });
    expect(selection.eligible.winback).toHaveLength(1);
    expect(selection.toSend).toHaveLength(0);
  });
});

describe('selectLifecycleCandidates', () => {
  it('skips suppressed addresses (case-insensitively), opt-outs and missing emails', () => {
    const suppressedUser = user({ email: 'Quiet@Example.com' });
    const optedOut = user();
    const noEmail = user({ email: null });
    const ok = user();
    const selection = select([suppressedUser, optedOut, noEmail, ok], {
      suppressedEmails: ['quiet@example.com'],
      optedOutUserIds: [optedOut.userId],
    });
    expect(selection.toSend.map((c) => c.userId)).toEqual([ok.userId]);
    expect(selection.eligible.welcome.map((c) => c.userId)).toEqual([ok.userId]);
  });

  it('never sends the same template to the same user twice', () => {
    const u = user();
    const selection = select([u], { sent: [{ userId: u.userId, template: 'welcome' }] });
    expect(selection.toSend).toHaveLength(0);
  });

  it('sends one email per user per run, highest-priority template first', () => {
    // 8 days old, has a project, just hit the limit: qualifies for day7 and limit_hit.
    const u = user({ createdAt: ago(8 * DAY), firstProjectAt: ago(7 * DAY), editCount: 6, dailyResetDate: '2026-10-18' });
    const selection = select([u]);
    expect(selection.eligible.day7).toHaveLength(1);
    expect(selection.eligible.limit_hit).toHaveLength(1);
    expect(selection.toSend).toEqual([expect.objectContaining({ userId: u.userId, template: 'limit_hit' })]);
  });

  it('orders oldest-eligible first and lower-cases the address', () => {
    const newer = user({ createdAt: ago(DAY + HOUR), email: 'New@Example.com' });
    const older = user({ createdAt: ago(2 * DAY) });
    const selection = select([newer, older]);
    expect(selection.toSend.map((c) => c.userId)).toEqual([older.userId, newer.userId]);
    expect(selection.toSend[1].email).toBe('new@example.com');
  });

  it('caps the run across templates, filling higher-priority templates first', () => {
    const limitUsers = Array.from({ length: 3 }, (_, i) =>
      user({ editCount: 5, dailyResetDate: i === 0 ? '2026-10-17' : '2026-10-18', firstProjectAt: ago(DAY) })
    );
    const welcomeUsers = Array.from({ length: 3 }, () => user());
    const selection = select([...welcomeUsers, ...limitUsers], { cap: 4 });
    expect(selection.toSend).toHaveLength(4);
    expect(selection.toSend.filter((c) => c.template === 'limit_hit')).toHaveLength(3);
    expect(selection.toSend.filter((c) => c.template === 'welcome')).toHaveLength(1);
    // The cap does not hide anyone from the eligible report.
    expect(selection.eligible.welcome).toHaveLength(3);
  });

  it('defaults to a 200-send cap', () => {
    const many = Array.from({ length: 250 }, () => user());
    expect(select(many).toSend).toHaveLength(200);
  });
});
