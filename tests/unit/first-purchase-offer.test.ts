import { describe, it, expect, beforeEach, vi } from 'vitest';

// Eligibility never asks Stripe: any Stripe call from these modules fails the test.
const mocks = vi.hoisted(() => ({ resolveStripeCustomer: vi.fn() }));
vi.mock('@/lib/stripe-customer', () => ({ resolveStripeCustomer: mocks.resolveStripeCustomer }));
vi.mock('@/lib/stripe', () => ({
  stripe: new Proxy({}, { get: () => { throw new Error('eligibility must not call Stripe'); } }),
}));

import {
  firstPurchaseOfferCopy,
  firstPurchaseOfferEnabled,
  firstPurchaseOfferFor,
  type FirstPurchaseOfferRow,
} from '@/lib/first-purchase-offer';
import { firstPurchaseOfferForUser, resolveFirstPurchaseOffer } from '@/lib/first-purchase-offer-server';
import { unlimitedEditEmails } from '@/lib/paywall';

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
    ['the unlimited status without the flag', { subscription_status: 'unlimited' }],
    ['is_pro set with no subscription (flag-only grant)', { is_pro: true }],
    ['is_pro set with a null status', { is_pro: true, subscription_status: null }],
    ['past_due', { subscription_status: 'past_due' }],
    ['past_due with a stored subscription id', { subscription_status: 'past_due', stripe_subscription_id: 'sub_1' }],
    ['unpaid', { subscription_status: 'unpaid' }],
    ['canceled (paid before)', { subscription_status: 'canceled' }],
    ['canceled with a stored subscription id', { subscription_status: 'canceled', stripe_subscription_id: 'sub_1' }],
    ['paused', { subscription_status: 'paused' }],
    ['paused with a stored subscription id', { subscription_status: 'paused', stripe_subscription_id: 'sub_1' }],
    ['incomplete_expired', { subscription_status: 'incomplete_expired' }],
  ])('is null with %s', (_name, overrides) => {
    expect(firstPurchaseOfferFor(freeRow(overrides), NOW)).toBeNull();
  });

  it('is null for staff on the email allowlist', () => {
    expect(firstPurchaseOfferFor(freeRow(), NOW, { hasUnlimited: true })).toBeNull();
  });

  it('is null when Stripe says the subscription is active even if the row is stale', () => {
    expect(firstPurchaseOfferFor(freeRow(), NOW, { stripeStatus: 'active' })).toBeNull();
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
    expect(
      firstPurchaseOfferFor(freeRow(), NOW, {
        env: { LIFECYCLE_WARM_LEAD_OFFER_ENABLED: 'false', FIRST_PURCHASE_OFFER_ENABLED: 'false' },
      })
    ).toBeNull();
    expect(firstPurchaseOfferFor(freeRow(), NOW, { env: {} })).toBe('welcome50');
  });
});

describe('firstPurchaseOfferCopy', () => {
  it('derives the copy from PRO_PLANS.monthly and the offer', () => {
    expect(firstPurchaseOfferCopy('welcome50')).toEqual({
      priceLine: '$4.99 first month, then $9.99/mo',
      note: '50% off your first month, applied at checkout',
      button: 'Go Pro with 50% off',
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
    const from = vi.fn(() => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: row, error: null }) }) }),
    }));
    return { from } as any;
  }

  beforeEach(() => mocks.resolveStripeCustomer.mockReset());

  it('offers to a never-paid user: one user_usage read, two ledger reads, no Stripe', async () => {
    const session = sessionClient(freeRow());
    const admin = ledgerAdmin();
    await expect(firstPurchaseOfferForUser(session, () => admin, user, NOW)).resolves.toBe('welcome50');
    expect(session.from).toHaveBeenCalledTimes(1);
    expect(admin.from).toHaveBeenCalledTimes(2);
    expect(mocks.resolveStripeCustomer).not.toHaveBeenCalled();
  });

  it('withholds after a spent one-off purchase (credits back at 0, ledger row remains)', async () => {
    const admin = ledgerAdmin({ credit: [{ id: 'c1' }] });
    await expect(firstPurchaseOfferForUser(sessionClient(freeRow()), () => admin, user, NOW)).resolves.toBeNull();
  });

  it('skips the ledgers (and never builds the admin client) for an ineligible row', async () => {
    const getAdmin = vi.fn(() => ledgerAdmin());
    await expect(
      firstPurchaseOfferForUser(sessionClient(freeRow({ edit_credits: 5 })), getAdmin, user, NOW)
    ).resolves.toBeNull();
    expect(getAdmin).not.toHaveBeenCalled();
  });

  it('withholds for staff on the allowlist and for a missing row', async () => {
    const getAdmin = vi.fn(() => ledgerAdmin());
    const staff = { id: 'u2', email: unlimitedEditEmails[0] };
    await expect(firstPurchaseOfferForUser(sessionClient(freeRow()), getAdmin, staff, NOW)).resolves.toBeNull();
    await expect(firstPurchaseOfferForUser(sessionClient(null), getAdmin, user, NOW)).resolves.toBeNull();
    expect(getAdmin).not.toHaveBeenCalled();
  });

  it('never throws: a failing admin client is no offer', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const getAdmin = () => {
      throw new Error('no service role key');
    };
    await expect(firstPurchaseOfferForUser(sessionClient(freeRow()), getAdmin, user, NOW)).resolves.toBeNull();
  });
});
