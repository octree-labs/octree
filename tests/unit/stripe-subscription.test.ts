import { describe, it, expect } from 'vitest';

import {
  PAUSE_PAID_THROUGH_KEY,
  appliedCouponId,
  describeSubscriptionOffers,
  effectiveSubscriptionStatus,
  isCancelFeedback,
  isPauseMonths,
  pausePaidThrough,
  pauseResumeTimestamp,
  subscriptionHasDiscount,
  subscriptionPeriod,
  subscriptionPeriodIso,
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

  it('keeps Pro until the paid-through date the pause route recorded, then pauses', () => {
    const paused = {
      status: 'active',
      pause_collection: { behavior: 'void', resumes_at: 2_000_000 },
      metadata: { user_id: 'user-1', [PAUSE_PAID_THROUGH_KEY]: '1500000' },
    } as any;
    expect(pausePaidThrough(paused)).toBe(1_500_000);
    expect(effectiveSubscriptionStatus(paused, 1_499_999)).toBe('active');
    expect(effectiveSubscriptionStatus(paused, 1_500_000)).toBe('paused');
    expect(effectiveSubscriptionStatus(paused, 1_900_000)).toBe('paused');
  });

  it('ignores the paid-through marker once the pause is gone, and a malformed one while it is set', () => {
    const resumed = {
      status: 'active',
      pause_collection: null,
      metadata: { [PAUSE_PAID_THROUGH_KEY]: '1500000' },
    } as any;
    expect(pausePaidThrough(resumed)).toBeNull();
    expect(effectiveSubscriptionStatus(resumed, 1)).toBe('active');

    const garbage = {
      status: 'active',
      pause_collection: { behavior: 'void', resumes_at: null },
      metadata: { [PAUSE_PAID_THROUGH_KEY]: 'soon' },
    } as any;
    expect(pausePaidThrough(garbage)).toBeNull();
    expect(effectiveSubscriptionStatus(garbage, 1)).toBe('paused');
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
  it('adds whole calendar months in UTC to the paid-through date and returns unix seconds', () => {
    const from = new Date('2026-10-18T12:34:56Z');
    expect(pauseResumeTimestamp(1, from)).toBe(Math.floor(Date.UTC(2026, 10, 18, 12, 34, 56) / 1000));
    expect(pauseResumeTimestamp(3, from)).toBe(Math.floor(Date.UTC(2027, 0, 18, 12, 34, 56) / 1000));
  });

  it('clamps to the last day of a shorter target month instead of rolling over', () => {
    const jan31 = new Date('2026-01-31T09:00:00Z');
    expect(pauseResumeTimestamp(1, jan31)).toBe(Math.floor(Date.UTC(2026, 1, 28, 9) / 1000));
    expect(pauseResumeTimestamp(3, jan31)).toBe(Math.floor(Date.UTC(2026, 3, 30, 9) / 1000));
    // Leap year.
    expect(pauseResumeTimestamp(1, new Date('2028-01-31T09:00:00Z'))).toBe(
      Math.floor(Date.UTC(2028, 1, 29, 9) / 1000)
    );
    // Crossing the year boundary from a 31-day month into a 30-day one.
    expect(pauseResumeTimestamp(2, new Date('2026-12-31T00:00:00Z'))).toBe(
      Math.floor(Date.UTC(2027, 1, 28) / 1000)
    );
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
      pause_paid_through: null,
      has_discount: false,
      discount_coupon_id: null,
      price: { unit_amount: 999, currency: 'usd', interval: 'month' },
    });
  });
});

/**
 * Since API 2025-03-31.basil the billing period lives on the subscription
 * items; the webhook endpoint renders payloads in that shape while the SDK
 * (acacia) still returns the top-level fields.
 */
describe('subscriptionPeriod', () => {
  it('reads the top-level fields (SDK, API 2025-02-24.acacia and earlier)', () => {
    expect(
      subscriptionPeriod({
        current_period_start: 1_700_000_000,
        current_period_end: 1_702_592_000,
        items: { data: [{ current_period_start: 1, current_period_end: 2 }] },
      })
    ).toEqual({ start: 1_700_000_000, end: 1_702_592_000 });
  });

  it('reads the first item when the subscription has no top-level period (API 2025-03-31.basil and later)', () => {
    expect(
      subscriptionPeriod({
        items: {
          data: [
            { current_period_start: 1_700_000_000, current_period_end: 1_702_592_000 },
            { current_period_start: 1_600_000_000, current_period_end: 1_605_000_000 },
          ],
        },
      })
    ).toEqual({ start: 1_700_000_000, end: 1_702_592_000 });
  });

  it('skips items that do not carry both fields', () => {
    expect(
      subscriptionPeriod({
        items: {
          data: [
            { current_period_start: 1_600_000_000 },
            null,
            { current_period_start: 1_700_000_000, current_period_end: 1_702_592_000 },
          ],
        },
      })
    ).toEqual({ start: 1_700_000_000, end: 1_702_592_000 });
  });

  it('returns nulls when items are empty or missing', () => {
    expect(subscriptionPeriod({ items: { data: [] } })).toEqual({ start: null, end: null });
    expect(subscriptionPeriod({})).toEqual({ start: null, end: null });
    expect(subscriptionPeriod({ current_period_start: null, current_period_end: undefined, items: null })).toEqual({
      start: null,
      end: null,
    });
    expect(subscriptionPeriod(null)).toEqual({ start: null, end: null });
  });

  it('takes each field from the top level when present and from the item otherwise (mixed)', () => {
    expect(
      subscriptionPeriod({
        current_period_start: 1_700_000_000,
        items: { data: [{ current_period_start: 1_699_000_000, current_period_end: 1_702_592_000 }] },
      })
    ).toEqual({ start: 1_700_000_000, end: 1_702_592_000 });
  });

  it('accepts a Stripe.Subscription-shaped object', () => {
    const sub = {
      id: 'sub_1',
      status: 'active',
      items: { object: 'list', data: [{ id: 'si_1', current_period_start: 10, current_period_end: 20 }] },
    } as any;
    expect(subscriptionPeriod(sub)).toEqual({ start: 10, end: 20 });
  });
});

describe('subscriptionPeriodIso', () => {
  it('converts Unix seconds to ISO timestamps and keeps nulls', () => {
    expect(
      subscriptionPeriodIso({ items: { data: [{ current_period_start: 1_700_000_000, current_period_end: 1_702_592_000 }] } })
    ).toEqual({
      start: new Date(1_700_000_000 * 1000).toISOString(),
      end: new Date(1_702_592_000 * 1000).toISOString(),
    });
    expect(subscriptionPeriodIso({})).toEqual({ start: null, end: null });
  });
});
