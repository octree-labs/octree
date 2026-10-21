import { describe, it, expect, beforeEach, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ resolveStripeCustomer: vi.fn() }));
vi.mock('@/lib/stripe-customer', () => ({ resolveStripeCustomer: mocks.resolveStripeCustomer }));

import {
  firstPurchaseOfferCopy,
  firstPurchaseOfferEnabled,
  firstPurchaseOfferFor,
  type FirstPurchaseOfferRow,
} from '@/lib/first-purchase-offer';
import { firstPurchaseOfferForUser, resolveFirstPurchaseOffer } from '@/lib/first-purchase-offer-server';

const NOW = new Date('2026-10-21T12:00:00Z');

function freeRow(overrides: Partial<FirstPurchaseOfferRow> = {}): FirstPurchaseOfferRow {
  return {
    is_pro: false,
    subscription_status: 'inactive',
    stripe_customer_id: null,
    stripe_subscription_id: null,
    current_period_end: null,
    edit_credits: 0,
    generation_credits: 0,
    ...overrides,
  };
}

describe('firstPurchaseOfferFor: eligibility matrix', () => {
  it('offers welcome50 to a free user who never paid', () => {
    expect(firstPurchaseOfferFor(freeRow(), NOW)).toBe('welcome50');
    expect(firstPurchaseOfferFor(freeRow({ subscription_status: null }), NOW)).toBe('welcome50');
  });

  it.each<[string, Partial<FirstPurchaseOfferRow>]>([
    ['a stored Stripe customer id', { stripe_customer_id: 'cus_1' }],
    ['a stored subscription id', { stripe_subscription_id: 'sub_1' }],
    ['edit credits left', { edit_credits: 3 }],
    ['generation credits left', { generation_credits: 1 }],
    ['an active Pro row', {
      is_pro: true,
      subscription_status: 'active',
      stripe_customer_id: 'cus_1',
      stripe_subscription_id: 'sub_1',
      current_period_end: '2026-11-21T00:00:00Z',
    }],
    ['a trialing Pro row', { subscription_status: 'trialing', stripe_subscription_id: 'sub_1' }],
    ['the unlimited grant', { subscription_status: 'unlimited', is_pro: true }],
    ['past_due', { subscription_status: 'past_due' }],
    ['unpaid', { subscription_status: 'unpaid' }],
    ['canceled (paid before)', { subscription_status: 'canceled' }],
    ['paused', { subscription_status: 'paused' }],
  ])('is null with %s', (_name, overrides) => {
    expect(firstPurchaseOfferFor(freeRow(overrides), NOW)).toBeNull();
  });

  it('is null for staff on the email allowlist', () => {
    expect(firstPurchaseOfferFor(freeRow(), NOW, { hasUnlimited: true })).toBeNull();
  });

  it('is null when Stripe says the subscription is active even if the row is stale', () => {
    expect(firstPurchaseOfferFor(freeRow(), NOW, { stripeStatus: 'active' })).toBeNull();
  });

  it('is null when a Stripe customer exists or could not be checked', () => {
    expect(firstPurchaseOfferFor(freeRow(), NOW, { stripeCustomer: true })).toBeNull();
    expect(firstPurchaseOfferFor(freeRow(), NOW, { stripeCustomer: 'unknown' })).toBeNull();
    expect(firstPurchaseOfferFor(freeRow(), NOW, { stripeCustomer: false })).toBe('welcome50');
  });

  it('is null after a one-off purchase whose credits are spent', () => {
    expect(firstPurchaseOfferFor(freeRow(), NOW, { hasPurchaseHistory: true })).toBeNull();
  });

  it('is null without a row', () => {
    expect(firstPurchaseOfferFor(null, NOW)).toBeNull();
  });

  it('honours both kill switches, defaulting on', () => {
    expect(firstPurchaseOfferEnabled({})).toBe(true);
    expect(firstPurchaseOfferEnabled({ LIFECYCLE_WARM_LEAD_OFFER_ENABLED: 'true' })).toBe(true);
    expect(firstPurchaseOfferFor(freeRow(), NOW, { env: { LIFECYCLE_WARM_LEAD_OFFER_ENABLED: 'false' } })).toBeNull();
    expect(firstPurchaseOfferFor(freeRow(), NOW, { env: { FIRST_PURCHASE_OFFER_ENABLED: 'false' } })).toBeNull();
    expect(firstPurchaseOfferFor(freeRow(), NOW, { env: {} })).toBe('welcome50');
  });
});

describe('firstPurchaseOfferCopy', () => {
  it('derives the copy from PRO_PLANS.monthly and the offer', () => {
    expect(firstPurchaseOfferCopy('welcome50')).toEqual({
      priceLine: '$4.99 first month, then $9.99/mo',
      note: '50% off your first month, applied at checkout',
      button: 'Go Pro — 50% off first month',
    });
  });
});

function ledgerAdmin(rows: { credit?: unknown[]; generation?: unknown[]; error?: boolean } = {}) {
  const from = vi.fn((table: string) => ({
    select: () => ({
      eq: () => ({
        limit: async () =>
          rows.error
            ? { data: null, error: { message: 'boom' } }
            : { data: table === 'credit_purchases' ? (rows.credit ?? []) : (rows.generation ?? []), error: null },
      }),
    }),
  }));
  return { from } as any;
}

describe('resolveFirstPurchaseOffer (purchase ledgers)', () => {
  it('offers when both ledgers are empty', async () => {
    const admin = ledgerAdmin();
    await expect(resolveFirstPurchaseOffer(admin, 'u1', freeRow(), { now: NOW })).resolves.toBe('welcome50');
    expect(admin.from).toHaveBeenCalledWith('credit_purchases');
    expect(admin.from).toHaveBeenCalledWith('generation_purchases');
  });

  it('withholds after a credit pack or a generation purchase', async () => {
    await expect(resolveFirstPurchaseOffer(ledgerAdmin({ credit: [{ id: 'x' }] }), 'u1', freeRow())).resolves.toBeNull();
    await expect(resolveFirstPurchaseOffer(ledgerAdmin({ generation: [{ id: 'x' }] }), 'u1', freeRow())).resolves.toBeNull();
  });

  it('fails closed on a ledger error', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(resolveFirstPurchaseOffer(ledgerAdmin({ error: true }), 'u1', freeRow())).resolves.toBeNull();
  });

  it('does not read the ledgers for a row that is already ineligible', async () => {
    const admin = ledgerAdmin();
    await expect(resolveFirstPurchaseOffer(admin, 'u1', freeRow({ stripe_customer_id: 'cus_1' }))).resolves.toBeNull();
    expect(admin.from).not.toHaveBeenCalled();
  });
});

describe('firstPurchaseOfferForUser (/buy)', () => {
  const user = { id: 'u1', email: 'new@example.com' };
  function sessionClient(row: FirstPurchaseOfferRow | null) {
    return {
      from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: row, error: null }) }) }) }),
    } as any;
  }

  beforeEach(() => {
    mocks.resolveStripeCustomer.mockReset();
    mocks.resolveStripeCustomer.mockResolvedValue(null);
  });

  it('offers to a never-paid user with no Stripe customer', async () => {
    await expect(firstPurchaseOfferForUser(sessionClient(freeRow()), ledgerAdmin(), user, NOW)).resolves.toBe('welcome50');
  });

  it('withholds when Stripe has a customer for the email', async () => {
    mocks.resolveStripeCustomer.mockResolvedValue({ customerId: 'cus_9', source: 'email' });
    await expect(firstPurchaseOfferForUser(sessionClient(freeRow()), ledgerAdmin(), user, NOW)).resolves.toBeNull();
  });

  it('withholds when the Stripe lookup fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.resolveStripeCustomer.mockRejectedValue(new Error('stripe down'));
    await expect(firstPurchaseOfferForUser(sessionClient(freeRow()), ledgerAdmin(), user, NOW)).resolves.toBeNull();
  });

  it('skips Stripe for an ineligible row', async () => {
    await expect(
      firstPurchaseOfferForUser(sessionClient(freeRow({ edit_credits: 5 })), ledgerAdmin(), user, NOW)
    ).resolves.toBeNull();
    expect(mocks.resolveStripeCustomer).not.toHaveBeenCalled();
  });
});
