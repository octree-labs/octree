import { describe, it, expect } from 'vitest';

import {
  eligibleSince,
  hitWhen,
  isWinbackPrecandidate,
  monthRef,
  selectLifecycleCandidates,
  type LifecycleUserRow,
} from '@/lib/lifecycle/select';
import { SCHEDULED_LIFECYCLE_TEMPLATES } from '@/lib/email/lifecycle';
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
    enabledTemplates: [...SCHEDULED_LIFECYCLE_TEMPLATES],
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

  // pro_inactive is the one template written for subscribers; it has its own
  // exclusions below.
  const upsellTemplates = SCHEDULED_LIFECYCLE_TEMPLATES.filter((t) => t !== 'pro_inactive');

  it.each(cases)('%s never gets any upsell email', (_label, overrides) => {
    const base: Partial<LifecycleUserRow> = {
      createdAt: ago(8 * DAY),
      firstProjectAt: ago(7 * DAY),
      editCount: 5,
      dailyResetDate: ago(0),
      stripeCustomerId: 'cus_1',
      subscriptionEndedAt: ago(30 * DAY),
    };
    for (const template of upsellTemplates) {
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
    expect(enabledTemplates({})).toEqual(new Set(['welcome', 'limit_hit', 'day7', 'pro_inactive', 'warm_lead_offer']));
    expect(enabledTemplates({ LIFECYCLE_WINBACK_ENABLED: 'false' }).has('winback')).toBe(false);
    expect(enabledTemplates({ LIFECYCLE_WINBACK_ENABLED: 'true' }).has('winback')).toBe(true);
  });

  it('is listed as eligible but not queued when disabled', () => {
    const selection = select([lapsed()], { enabledTemplates: ['welcome', 'limit_hit', 'day7'] });
    expect(selection.eligible.winback).toHaveLength(1);
    expect(selection.toSend).toHaveLength(0);
  });
});

describe('pro_inactive', () => {
  // A paying subscriber per the entitlement rule: active, names a Stripe
  // subscription, period end in the future.
  const pro = (over: Partial<LifecycleUserRow> = {}) =>
    user({
      createdAt: ago(60 * DAY),
      isPro: true,
      subscriptionStatus: 'active',
      stripeCustomerId: 'cus_1',
      stripeSubscriptionId: 'sub_1',
      currentPeriodEnd: new Date(NOW.getTime() + 20 * DAY).toISOString(),
      firstProjectAt: ago(50 * DAY),
      lastActivityAt: ago(10 * DAY),
      ...over,
    });

  it('goes to a Pro subscriber idle for 7 days, dated from the end of the quiet week', () => {
    expect(eligibleSince(pro(), 'pro_inactive', NOW)).toBe(Date.parse(ago(10 * DAY)) + 7 * DAY);
    expect(eligibleSince(pro({ lastActivityAt: ago(7 * DAY) }), 'pro_inactive', NOW)).not.toBeNull();
    expect(eligibleSince(pro({ subscriptionStatus: 'trialing' }), 'pro_inactive', NOW)).not.toBeNull();
  });

  it('is not sent while there was activity inside the window', () => {
    expect(eligibleSince(pro({ lastActivityAt: ago(6 * DAY + 23 * HOUR) }), 'pro_inactive', NOW)).toBeNull();
    expect(eligibleSince(pro({ lastActivityAt: ago(HOUR) }), 'pro_inactive', NOW)).toBeNull();
    // daily_reset_date is a date; the loader folds it into lastActivityAt.
    expect(eligibleSince(pro({ lastActivityAt: '2026-10-15' }), 'pro_inactive', NOW)).toBeNull();
    expect(eligibleSince(pro({ lastActivityAt: '2026-10-01' }), 'pro_inactive', NOW)).not.toBeNull();
  });

  it('is not sent when no activity is known at all', () => {
    expect(eligibleSince(pro({ lastActivityAt: null }), 'pro_inactive', NOW)).toBeNull();
    expect(eligibleSince(pro({ lastActivityAt: undefined }), 'pro_inactive', NOW)).toBeNull();
  });

  it('is not sent in the first week of a billing period: someone who just paid is not "inactive"', () => {
    // Idle as a free user for ten days, then bought Pro this morning: the
    // purchase itself writes nothing to projects or generated_documents.
    expect(eligibleSince(pro({ currentPeriodStart: ago(HOUR) }), 'pro_inactive', NOW)).toBeNull();
    expect(eligibleSince(pro({ currentPeriodStart: ago(6 * DAY + 23 * HOUR) }), 'pro_inactive', NOW)).toBeNull();
    // A renewal is a fresh period too; a week after it the rule applies again.
    expect(eligibleSince(pro({ currentPeriodStart: ago(7 * DAY) }), 'pro_inactive', NOW)).not.toBeNull();
    expect(eligibleSince(pro({ currentPeriodStart: ago(20 * DAY) }), 'pro_inactive', NOW)).not.toBeNull();
    // A row from before the period columns existed (null) does not block.
    expect(eligibleSince(pro({ currentPeriodStart: null }), 'pro_inactive', NOW)).not.toBeNull();
    // Nor is the quiet week dated before the period started.
    expect(eligibleSince(pro({ currentPeriodStart: ago(8 * DAY), lastActivityAt: ago(30 * DAY) }), 'pro_inactive', NOW)).toBe(
      Date.parse(ago(8 * DAY)) + 7 * DAY
    );
  });

  it('is not sent to anyone who is not entitled to Pro (same rule as the app)', () => {
    expect(eligibleSince(pro({ isPro: false, subscriptionStatus: 'canceled' }), 'pro_inactive', NOW)).toBeNull();
    // A bare is_pro flag grants nothing.
    expect(eligibleSince(pro({ subscriptionStatus: 'inactive' }), 'pro_inactive', NOW)).toBeNull();
    expect(eligibleSince(pro({ subscriptionStatus: 'past_due' }), 'pro_inactive', NOW)).toBeNull();
    expect(eligibleSince(pro({ subscriptionStatus: 'paused' }), 'pro_inactive', NOW)).toBeNull();
    expect(eligibleSince(pro({ stripeSubscriptionId: null }), 'pro_inactive', NOW)).toBeNull();
    expect(eligibleSince(pro({ currentPeriodEnd: ago(DAY) }), 'pro_inactive', NOW)).toBeNull();
    expect(eligibleSince(user({ lastActivityAt: ago(30 * DAY) }), 'pro_inactive', NOW)).toBeNull();
  });

  it('never goes to staff or manual grants, even when the row looks like Pro', () => {
    expect(eligibleSince(pro({ role: 'admin' }), 'pro_inactive', NOW)).toBeNull();
    expect(eligibleSince(pro({ role: 'unlimited' }), 'pro_inactive', NOW)).toBeNull();
    expect(eligibleSince(pro({ subscriptionStatus: 'unlimited', stripeSubscriptionId: null }), 'pro_inactive', NOW)).toBeNull();
    expect(eligibleSince(pro({ email: 'rascodes123@gmail.com' }), 'pro_inactive', NOW)).toBeNull();
  });

  it('keys the ledger on the calendar month, so at most one per month', () => {
    const u = pro();
    expect(monthRef(NOW)).toBe('2026-10');
    const fresh = select([u]);
    expect(fresh.toSend).toEqual([expect.objectContaining({ userId: u.userId, template: 'pro_inactive', ref: '2026-10' })]);

    const sentThisMonth = select([u], { sent: [{ userId: u.userId, template: 'pro_inactive', ref: '2026-10' }] });
    expect(sentThisMonth.toSend).toHaveLength(0);
    expect(sentThisMonth.eligible.pro_inactive).toHaveLength(0);

    const sentLastMonth = select([u], { sent: [{ userId: u.userId, template: 'pro_inactive', ref: '2026-09' }] });
    expect(sentLastMonth.toSend).toHaveLength(1);
  });

  it('respects suppressions and the marketing opt-out like every other template', () => {
    const suppressed = pro({ email: 'Quiet@Example.com' });
    const optedOut = pro();
    const selection = select([suppressed, optedOut], {
      suppressedEmails: ['quiet@example.com'],
      optedOutUserIds: [optedOut.userId],
    });
    expect(selection.toSend).toHaveLength(0);
  });

  it('is on by default and ranks below the free-tier templates', () => {
    expect(enabledTemplates({}).has('pro_inactive')).toBe(true);
    const selection = select([pro(), user()]);
    expect(selection.toSend.map((c) => c.template)).toEqual(['welcome', 'pro_inactive']);
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

describe('warm_lead_offer', () => {
  const hit = (msAgo: number, reason = 'daily_limit', feature = 'ai-edit') => ({
    lastPaywallHit: { feature, reason, createdAt: ago(msAgo) },
  });
  // An older account with a project: qualifies for no other template.
  const lead = (overrides: Partial<LifecycleUserRow> = {}) =>
    user({ createdAt: ago(30 * DAY), firstProjectAt: ago(29 * DAY), ...hit(2 * HOUR), ...overrides });

  it('goes to a free user whose latest paywall hit is 1h..3d old, dated from the hit', () => {
    const u = lead();
    expect(eligibleSince(u, 'warm_lead_offer', NOW)).toBe(Date.parse(u.lastPaywallHit!.createdAt));
    expect(eligibleSince(lead(hit(3 * DAY - HOUR)), 'warm_lead_offer', NOW)).not.toBeNull();
  });

  it('waits an hour after the hit and gives up after three days', () => {
    expect(eligibleSince(lead(hit(30 * 60 * 1000)), 'warm_lead_offer', NOW)).toBeNull();
    expect(eligibleSince(lead(hit(4 * DAY)), 'warm_lead_offer', NOW)).toBeNull();
    expect(eligibleSince(lead({ lastPaywallHit: null }), 'warm_lead_offer', NOW)).toBeNull();
  });

  it('never goes to Pro, a manual grant, a Stripe subscriber or staff', () => {
    const periodEnd = new Date(NOW.getTime() + 10 * DAY).toISOString();
    expect(
      eligibleSince(
        lead({ isPro: true, subscriptionStatus: 'active', stripeSubscriptionId: 'sub_1', currentPeriodEnd: periodEnd }),
        'warm_lead_offer',
        NOW
      )
    ).toBeNull();
    expect(eligibleSince(lead({ subscriptionStatus: 'unlimited' }), 'warm_lead_offer', NOW)).toBeNull();
    // A lapsed subscription id on the row still blocks it (no discount stacking on a returning payer).
    expect(eligibleSince(lead({ subscriptionStatus: 'canceled', stripeSubscriptionId: 'sub_old' }), 'warm_lead_offer', NOW)).toBeNull();
    expect(eligibleSince(lead({ role: 'admin' }), 'warm_lead_offer', NOW)).toBeNull();
  });

  it('never goes to a flag-only Pro, a past_due / paused subscriber or anyone who has paid before', () => {
    // is_pro without a subscription grants nothing by the entitlement rule,
    // but it is still a subscription relationship: no discount pitch.
    expect(eligibleSince(lead({ isPro: true }), 'warm_lead_offer', NOW)).toBeNull();
    expect(eligibleSince(lead({ subscriptionStatus: 'past_due' }), 'warm_lead_offer', NOW)).toBeNull();
    expect(eligibleSince(lead({ subscriptionStatus: 'paused' }), 'warm_lead_offer', NOW)).toBeNull();
    // WELCOME50 is first-time-transaction only: Stripe would refuse it.
    expect(eligibleSince(lead({ stripeCustomerId: 'cus_1' }), 'warm_lead_offer', NOW)).toBeNull();
    expect(eligibleSince(lead({ hasOneOffPurchase: true }), 'warm_lead_offer', NOW)).toBeNull();
    expect(eligibleSince(lead({ subscriptionStatus: 'inactive', hasOneOffPurchase: false }), 'warm_lead_offer', NOW)).not.toBeNull();
  });

  it('needs an email', () => {
    expect(select([lead({ email: null })]).eligible.warm_lead_offer).toHaveLength(0);
  });

  it('treats a ledger row under any ref as sent, for itself and for the limit_hit exclusion', () => {
    const u = lead({ editCount: 5, dailyResetDate: '2026-10-18' });
    const offerSent = select([u], { sent: [{ userId: u.userId, template: 'warm_lead_offer', ref: 'manual' }] });
    expect(offerSent.eligible.warm_lead_offer).toHaveLength(0);
    expect(offerSent.eligible.limit_hit).toHaveLength(0);
    const limitSent = select([u], { sent: [{ userId: u.userId, template: 'limit_hit', ref: 'manual' }] });
    expect(limitSent.eligible.warm_lead_offer).toHaveLength(0);
  });

  it('outranks limit_hit, so a user eligible for both gets the offer', () => {
    const u = lead({ editCount: 5, dailyResetDate: '2026-10-18' });
    const selection = select([u]);
    expect(selection.eligible.limit_hit).toHaveLength(1);
    expect(selection.toSend).toEqual([expect.objectContaining({ userId: u.userId, template: 'warm_lead_offer' })]);
  });

  it('is not sent to someone who already got limit_hit', () => {
    const u = lead();
    const selection = select([u], { sent: [{ userId: u.userId, template: 'limit_hit', ref: '' }] });
    expect(selection.eligible.warm_lead_offer).toHaveLength(0);
    expect(selection.toSend).toHaveLength(0);
  });

  it('blocks limit_hit for someone who already got the offer', () => {
    const u = lead({ editCount: 5, dailyResetDate: '2026-10-18' });
    const selection = select([u], { sent: [{ userId: u.userId, template: 'warm_lead_offer', ref: '' }] });
    expect(selection.eligible.limit_hit).toHaveLength(0);
    expect(selection.eligible.warm_lead_offer).toHaveLength(0);
    expect(selection.toSend).toHaveLength(0);
  });

  it('goes out once per user ever (ledger ref "")', () => {
    const u = lead();
    const selection = select([u], { sent: [{ userId: u.userId, template: 'warm_lead_offer', ref: '' }] });
    expect(selection.toSend).toHaveLength(0);
    expect(select([u]).toSend[0]).not.toHaveProperty('ref');
  });

  it('sends the oldest hits first under the cap', () => {
    const newer = lead(hit(2 * HOUR));
    const older = lead(hit(2 * DAY));
    expect(select([newer, older], { cap: 1 }).toSend.map((c) => c.userId)).toEqual([older.userId]);
  });

  it('carries the hit in the payload and renders the subject for its reason', () => {
    const input = { appUrl: 'https://app.example.com', toolsUrl: 'https://tools.example.com', unsubscribeUrl: 'https://u' };
    const [daily] = select([lead(hit(2 * HOUR, 'daily_limit', 'ai-edit'))]).toSend;
    expect(daily.payload).toMatchObject({ reason: 'daily_limit', feature: 'ai-edit' });
    expect(daily.render!(input).subject).toContain('daily AI edit limit');
    const [exportHit] = select([lead(hit(DAY, 'pro_feature', 'export'))]).toSend;
    expect(exportHit.render!(input).subject).toContain('Your PDF is one step away');
  });

  it('is on by default and off with LIFECYCLE_WARM_LEAD_OFFER_ENABLED=false', () => {
    expect(enabledTemplates({}).has('warm_lead_offer')).toBe(true);
    expect(enabledTemplates({ LIFECYCLE_WARM_LEAD_OFFER_ENABLED: 'true' }).has('warm_lead_offer')).toBe(true);
    const off = enabledTemplates({ LIFECYCLE_WARM_LEAD_OFFER_ENABLED: 'false' });
    expect(off.has('warm_lead_offer')).toBe(false);
    const selection = select([lead()], { enabledTemplates: off });
    expect(selection.eligible.warm_lead_offer).toHaveLength(1);
    expect(selection.toSend).toHaveLength(0);
  });

  it('with the offer switched off, limit_hit still reaches a user who qualifies for both', () => {
    const u = lead({ editCount: 5, dailyResetDate: '2026-10-18' });
    const selection = select([u], { enabledTemplates: enabledTemplates({ LIFECYCLE_WARM_LEAD_OFFER_ENABLED: 'false' }) });
    expect(selection.toSend).toEqual([expect.objectContaining({ template: 'limit_hit' })]);
  });

  it('words the hit time', () => {
    expect(hitWhen(2 * HOUR)).toBe('earlier today');
    expect(hitWhen(DAY)).toBe('yesterday');
    expect(hitWhen(2 * DAY + 12 * HOUR)).toBe('a couple of days ago');
  });
});
