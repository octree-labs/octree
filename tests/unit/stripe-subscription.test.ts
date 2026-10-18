import { describe, it, expect } from 'vitest';

import {
  appliedCouponId,
  describeSubscriptionOffers,
  effectiveSubscriptionStatus,
  isCancelFeedback,
  isPauseMonths,
  pauseResumeTimestamp,
  subscriptionHasDiscount,
  trimCancelComment,
} from '@/lib/stripe-subscription';

/** Pure helpers behind the cancel flow (lib/stripe-subscription.ts). */
describe('effectiveSubscriptionStatus', () => {
  it('reports a paused active subscription as paused', () => {
    expect(
      effectiveSubscriptionStatus({ status: 'active', pause_collection: { behavior: 'void', resumes_at: 1 } } as any)
    ).toBe('paused');
    expect(
      effectiveSubscriptionStatus({ status: 'trialing', pause_collection: { behavior: 'void', resumes_at: null } } as any)
    ).toBe('paused');
  });

  it('passes every other status through, paused or not', () => {
    expect(effectiveSubscriptionStatus({ status: 'active', pause_collection: null } as any)).toBe('active');
    expect(effectiveSubscriptionStatus({ status: 'active' } as any)).toBe('active');
    expect(
      effectiveSubscriptionStatus({ status: 'past_due', pause_collection: { behavior: 'void' } } as any)
    ).toBe('past_due');
    expect(effectiveSubscriptionStatus({ status: 'canceled' } as any)).toBe('canceled');
  });
});

describe('subscriptionHasDiscount / appliedCouponId', () => {
  it('reads the current `discounts` array and the deprecated `discount` field', () => {
    expect(subscriptionHasDiscount({ status: 'active', discounts: [], discount: null } as any)).toBe(false);
    expect(subscriptionHasDiscount({ status: 'active', discounts: ['di_1'] } as any)).toBe(true);
    expect(subscriptionHasDiscount({ status: 'active', discount: { id: 'di_1' } } as any)).toBe(true);
    expect(
      appliedCouponId({ status: 'active', discounts: [{ id: 'di_1', coupon: { id: 'save50-2mo' } }] } as any)
    ).toBe('save50-2mo');
    expect(appliedCouponId({ status: 'active', discounts: ['di_1'] } as any)).toBeNull();
    expect(appliedCouponId({ status: 'active', discount: { coupon: { id: 'other' } } } as any)).toBe('other');
  });
});

describe('pauseResumeTimestamp', () => {
  it('adds whole calendar months in UTC and returns unix seconds', () => {
    const now = new Date('2026-10-18T12:00:00Z');
    expect(pauseResumeTimestamp(1, now)).toBe(Math.floor(Date.UTC(2026, 10, 18, 12) / 1000));
    expect(pauseResumeTimestamp(3, now)).toBe(Math.floor(Date.UTC(2027, 0, 18, 12) / 1000));
  });
});

describe('request validation', () => {
  it('accepts only 1, 2 or 3 months', () => {
    expect([1, 2, 3].every(isPauseMonths)).toBe(true);
    expect([0, 4, '1', null, undefined, 1.5].some(isPauseMonths)).toBe(false);
  });

  it("accepts only Stripe's feedback enum", () => {
    expect(isCancelFeedback('unused')).toBe(true);
    expect(isCancelFeedback('switched_service')).toBe(true);
    expect(isCancelFeedback('bugs')).toBe(false);
    expect(isCancelFeedback('')).toBe(false);
    expect(isCancelFeedback(undefined)).toBe(false);
  });

  it('trims and caps the comment, dropping an empty one', () => {
    expect(trimCancelComment('  hi  ')).toBe('hi');
    expect(trimCancelComment('   ')).toBeUndefined();
    expect(trimCancelComment(42)).toBeUndefined();
    expect(trimCancelComment('x'.repeat(600))).toHaveLength(500);
  });
});

describe('describeSubscriptionOffers', () => {
  it('flattens what the dialog needs', () => {
    const state = describeSubscriptionOffers({
      id: 'sub_1',
      status: 'active',
      cancel_at_period_end: false,
      current_period_end: 1_702_592_000,
      pause_collection: { behavior: 'void', resumes_at: 1_705_000_000 },
      discounts: [],
      discount: null,
      items: { data: [{ price: { unit_amount: 999, currency: 'usd', recurring: { interval: 'month' } } }] },
    } as any);

    expect(state).toEqual({
      id: 'sub_1',
      status: 'active',
      effective_status: 'paused',
      cancel_at_period_end: false,
      current_period_end: 1_702_592_000,
      paused_until: 1_705_000_000,
      has_discount: false,
      discount_coupon_id: null,
      price: { unit_amount: 999, currency: 'usd', interval: 'month' },
    });
  });
});
