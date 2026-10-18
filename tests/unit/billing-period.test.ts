import { describe, it, expect } from 'vitest';

import {
  billingRowMatches,
  monthlyResetDateFor,
  startsNewBillingPeriod,
  type IncomingSubscription,
  type StoredBillingRow,
} from '@/lib/subscription/billing-period';

/**
 * The reset decision behind both user_usage writers (Stripe webhook,
 * subscription-status route). Before this rule every active write zeroed
 * monthly_edit_count, and the status route writes on every page load, so
 * Pro counters never left 0.
 */

const incoming: IncomingSubscription = {
  customerId: 'cus_1',
  subscriptionId: 'sub_1',
  status: 'active',
  isPro: true,
  currentPeriodStart: '2026-10-01T00:00:00.000Z',
  currentPeriodEnd: '2026-11-01T00:00:00.000Z',
  cancelAtPeriodEnd: false,
};

const stored: StoredBillingRow = {
  is_pro: true,
  stripe_customer_id: 'cus_1',
  stripe_subscription_id: 'sub_1',
  subscription_status: 'active',
  // Postgres renders timestamptz with an offset, not `Z`.
  current_period_start: '2026-10-01T00:00:00+00:00',
  current_period_end: '2026-11-01T00:00:00+00:00',
  cancel_at_period_end: false,
  // Pinned to the period end by the last reset.
  monthly_reset_date: '2026-11-01',
};

describe('startsNewBillingPeriod', () => {
  it('does not reset when the write repeats the current period (a status read)', () => {
    expect(startsNewBillingPeriod(stored, incoming)).toBe(false);
  });

  it('does not reset for a cancel_at_period_end toggle, a discount or a pause within the period', () => {
    expect(startsNewBillingPeriod(stored, { ...incoming, cancelAtPeriodEnd: true })).toBe(false);
    expect(startsNewBillingPeriod(stored, { ...incoming, status: 'paused', isPro: false })).toBe(false);
  });

  it('resets on the first activation (row not Pro yet)', () => {
    expect(startsNewBillingPeriod({ ...stored, is_pro: false, stripe_subscription_id: null, current_period_start: null }, incoming)).toBe(true);
    expect(startsNewBillingPeriod(null, incoming)).toBe(true);
  });

  it('resets when the subscription id changes', () => {
    expect(startsNewBillingPeriod({ ...stored, stripe_subscription_id: 'sub_old' }, incoming)).toBe(true);
  });

  it('resets when current_period_start moves forward (renewal) and not when it stays or goes back', () => {
    expect(startsNewBillingPeriod(stored, { ...incoming, currentPeriodStart: '2026-11-01T00:00:00.000Z' })).toBe(true);
    expect(startsNewBillingPeriod(stored, { ...incoming, currentPeriodStart: '2026-09-01T00:00:00.000Z' })).toBe(false);
  });

  it('resets when the row has Pro but never recorded a period (manual grant, then a real subscription)', () => {
    expect(startsNewBillingPeriod({ ...stored, current_period_start: null }, incoming)).toBe(true);
  });

  it('never resets a write that does not grant Pro', () => {
    expect(startsNewBillingPeriod({ ...stored, is_pro: false }, { ...incoming, status: 'canceled', isPro: false })).toBe(false);
  });

  it('keeps the counter when Pro comes back inside the period it was already reset for (past_due recovery, dashboard pause then resume)', () => {
    expect(startsNewBillingPeriod({ ...stored, is_pro: false, subscription_status: 'past_due' }, incoming)).toBe(false);
    expect(startsNewBillingPeriod({ ...stored, is_pro: false, subscription_status: 'paused' }, incoming)).toBe(false);
  });

  it('resets when Pro comes back after the cycle turned while it was off (renewal failed then paid; pause past the period end)', () => {
    // The paused / past_due write already carried the new period, so
    // current_period_start no longer moves; monthly_reset_date still says
    // the old period.
    const rolledWhileOff: StoredBillingRow = {
      ...stored,
      is_pro: false,
      subscription_status: 'paused',
      current_period_start: '2026-11-01T00:00:00+00:00',
      current_period_end: '2026-12-01T00:00:00+00:00',
      monthly_reset_date: '2026-11-01',
    };
    const nextPeriod = {
      ...incoming,
      currentPeriodStart: '2026-11-01T00:00:00.000Z',
      currentPeriodEnd: '2026-12-01T00:00:00.000Z',
    };
    expect(startsNewBillingPeriod(rolledWhileOff, nextPeriod)).toBe(true);
  });

  it('resets when Pro comes back and the row never recorded a reset date (webhook read without the column)', () => {
    expect(startsNewBillingPeriod({ ...stored, is_pro: false, monthly_reset_date: undefined }, incoming)).toBe(true);
  });
});

describe('billingRowMatches', () => {
  it('is true when the row already holds what Stripe says, across timestamp renderings', () => {
    expect(billingRowMatches(stored, incoming)).toBe(true);
  });

  it.each([
    ['is_pro', { is_pro: false }],
    ['customer', { stripe_customer_id: 'cus_2' }],
    ['subscription', { stripe_subscription_id: 'sub_2' }],
    ['status', { subscription_status: 'paused' }],
    ['cancel_at_period_end', { cancel_at_period_end: true }],
    ['period start', { current_period_start: '2026-11-01T00:00:00+00:00' }],
    ['period end', { current_period_end: '2026-12-01T00:00:00+00:00' }],
    ['missing period', { current_period_start: null }],
  ])('is false when %s differs', (_label, overrides) => {
    expect(billingRowMatches({ ...stored, ...overrides }, incoming)).toBe(false);
  });

  it('is false without a row', () => {
    expect(billingRowMatches(null, incoming)).toBe(false);
  });
});

describe('monthlyResetDateFor', () => {
  const now = new Date('2026-10-18T12:00:00.000Z');

  it('uses the billing date Stripe sent', () => {
    expect(monthlyResetDateFor('2026-11-17T19:52:49.000Z', now)).toBe('2026-11-17');
  });

  it('falls back to 30 days out when the period end is missing or already past', () => {
    expect(monthlyResetDateFor(null, now)).toBe('2026-11-17');
    expect(monthlyResetDateFor('2026-10-01T00:00:00.000Z', now)).toBe('2026-11-17');
  });
});
