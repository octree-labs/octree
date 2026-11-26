import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

import {
  API_PRO_DAILY_COMPILES,
  MONEY_BACK_GUARANTEE_DAYS,
  PRO_MONTHLY_EDIT_LIMIT,
  SUPPORT_EMAIL,
} from '@/data/constants';
import {
  OFFER_V2_FLAG_KEY,
  offerVariantFromFlag,
  offerVariantOverride,
  resolveOfferVariant,
} from '@/lib/offer-v2/variant';
import { getOfferVariant, resetOfferVariantCacheForTests } from '@/lib/offer-v2/variant-server';
import {
  MIN_PROOF_COUNT,
  OFFER_DEADLINE_HOURS,
  TESTIMONIALS,
  formatCountdown,
  guaranteeLine,
  guaranteeText,
  offerDeadline,
  offerPlanCopy,
  offerValueStack,
  perMonthFromAnnual,
  proofLine,
} from '@/lib/offer-v2/offer';
import { pricingCatalog } from '@/lib/pricing-catalog';
import { buildCheckoutSessionParams } from '@/lib/checkout-plans';
import { OfferV2Plans } from '@/components/subscription/offer-v2-plans';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/posthog-server', () => ({ getPostHogServer: () => null }));

describe('onboarding-offer-v2 variant resolution', () => {
  beforeEach(() => resetOfferVariantCacheForTests());

  it('NEXT_PUBLIC_OFFER_V2=on|off forces the variant; anything else defers to the flag', () => {
    expect(offerVariantOverride('on')).toBe('offer_v2');
    expect(offerVariantOverride(' OFF ')).toBe('control');
    expect(offerVariantOverride('')).toBeNull();
    expect(offerVariantOverride(undefined)).toBeNull();
    expect(offerVariantOverride('true')).toBeNull();
    expect(resolveOfferVariant({ override: 'off', flagValue: 'offer_v2' })).toBe('control');
    expect(resolveOfferVariant({ override: undefined, flagValue: 'offer_v2' })).toBe('offer_v2');
  });

  it('an unknown or missing flag value is control', () => {
    expect(offerVariantFromFlag('offer_v2')).toBe('offer_v2');
    expect(offerVariantFromFlag('control')).toBe('control');
    for (const value of [undefined, null, true, false, 'test', 42]) {
      expect(offerVariantFromFlag(value)).toBe('control');
    }
  });

  it('asks PostHog for the user id with the flag key', async () => {
    const client = { getFeatureFlag: vi.fn().mockResolvedValue('offer_v2') };
    await expect(getOfferVariant('user-1', { env: {}, client })).resolves.toBe('offer_v2');
    expect(client.getFeatureFlag).toHaveBeenCalledWith(OFFER_V2_FLAG_KEY, 'user-1');
  });

  it('the env override wins without calling PostHog', async () => {
    const client = { getFeatureFlag: vi.fn().mockResolvedValue('control') };
    await expect(getOfferVariant('user-1', { env: { NEXT_PUBLIC_OFFER_V2: 'on' }, client })).resolves.toBe('offer_v2');
    await expect(getOfferVariant('user-2', { env: { NEXT_PUBLIC_OFFER_V2: 'off' }, client })).resolves.toBe('control');
    expect(client.getFeatureFlag).not.toHaveBeenCalled();
  });

  it('falls back to control when PostHog is not configured, fails, or is slow', async () => {
    await expect(getOfferVariant('u-none', { env: {}, client: null })).resolves.toBe('control');
    const failing = { getFeatureFlag: vi.fn().mockRejectedValue(new Error('network')) };
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(getOfferVariant('u-fail', { env: {}, client: failing })).resolves.toBe('control');

    vi.useFakeTimers();
    try {
      const slow = { getFeatureFlag: vi.fn(() => new Promise(() => {})) };
      const pending = getOfferVariant('u-slow', { env: {}, client: slow });
      await vi.advanceTimersByTimeAsync(1600);
      await expect(pending).resolves.toBe('control');
    } finally {
      vi.useRealTimers();
    }
  });

  it('caches an answer per user for a while (assignments are sticky)', async () => {
    const client = { getFeatureFlag: vi.fn().mockResolvedValue('offer_v2') };
    await getOfferVariant('user-c', { env: {}, client, now: 0 });
    await getOfferVariant('user-c', { env: {}, client, now: 60_000 });
    expect(client.getFeatureFlag).toHaveBeenCalledTimes(1);
    await getOfferVariant('user-c', { env: {}, client, now: 11 * 60_000 });
    expect(client.getFeatureFlag).toHaveBeenCalledTimes(2);
  });
});

describe('offer_v2 copy uses the real constants', () => {
  it('value stack: the Pro edit limit and API limit, compile fixes only while switched on', () => {
    const stack = offerValueStack({ compileErrorFix: true });
    expect(stack[0]).toContain(`${PRO_MONTHLY_EDIT_LIMIT} AI edits a month`);
    expect(stack.some((line) => line.includes(API_PRO_DAILY_COMPILES.toLocaleString('en-US')))).toBe(true);
    expect(stack.some((line) => /compile/i.test(line) && /fix/i.test(line))).toBe(true);
    expect(offerValueStack({ compileErrorFix: false }).some((line) => /fixes when/i.test(line))).toBe(false);
    // No invented dollar values or template counts.
    expect(stack.join(' ')).not.toMatch(/\$|worth|templates/i);
  });

  it('guarantee names the real support inbox and the guarantee window', () => {
    expect(SUPPORT_EMAIL).toBe('basil@useoctree.com');
    expect(guaranteeText()).toContain(SUPPORT_EMAIL);
    expect(guaranteeText()).toContain(`${MONEY_BACK_GUARANTEE_DAYS} days`);
    expect(guaranteeLine()).toMatch(/^7-day money-back guarantee: /);
    expect(guaranteeLine().length).toBeLessThanOrEqual(1200);
  });

  it('testimonials start empty (the owner supplies real ones)', () => {
    expect(TESTIMONIALS).toEqual([]);
  });

  it('proof line only from a real count at or above the threshold', () => {
    expect(proofLine(null)).toBeNull();
    expect(proofLine(MIN_PROOF_COUNT - 1)).toBeNull();
    expect(proofLine(1234)).toBe('1,234 documents started on Octree in the last 7 days');
  });
});

describe('offer_v2 plan cards at every price tier', () => {
  it('annual shows its monthly equivalent computed from the tier price', () => {
    expect(perMonthFromAnnual(79)).toBe('$6.58');
    const standard = offerPlanCopy(pricingCatalog('standard'));
    expect(standard.annual.price).toBe('$6.58/mo');
    expect(standard.annual.detail).toBe('billed $79/yr. Cancel anytime.');
    const tier2 = offerPlanCopy(pricingCatalog('tier2'));
    expect(tier2.annual.price).toBe('$3.92/mo');
    expect(tier2.annual.detail).toContain('$47/yr');
    const tier3 = offerPlanCopy(pricingCatalog('tier3'));
    expect(tier3.annual.price).toBe('$2.58/mo');
    expect(tier3.monthly.price).toBe('$3.99/mo');
    expect(tier3.semester.price).toBe('$12');
    expect(tier3.deadline_pass.price).toBe('$1.99 once');
    expect(tier3.deadline_pass.detail).toContain('7 days of Pro');
  });

  it('the monthly card carries the first-month price while the sign-up offer runs', () => {
    const copy = offerPlanCopy(pricingCatalog('standard'), { price: '$5.00', percentOff: 50 });
    expect(copy.monthly).toMatchObject({ price: '$5.00 first month', detail: 'then $9.99/mo. Cancel anytime.', badge: '50% off' });
  });
});

describe('the honest 48 h deadline', () => {
  const created = '2026-11-25T10:00:00Z';

  it('ends 48 hours after sign-up', () => {
    expect(OFFER_DEADLINE_HOURS).toBe(48);
    expect(offerDeadline(created, new Date('2026-11-25T10:00:01Z'))?.toISOString()).toBe('2026-11-27T10:00:00.000Z');
    expect(offerDeadline(created, new Date('2026-11-27T09:59:59Z'))?.toISOString()).toBe('2026-11-27T10:00:00.000Z');
  });

  it('is gone at and after 48 hours, and for an unknown sign-up time', () => {
    expect(offerDeadline(created, new Date('2026-11-27T10:00:00Z'))).toBeNull();
    expect(offerDeadline(created, new Date('2026-12-01T00:00:00Z'))).toBeNull();
    expect(offerDeadline(null, new Date())).toBeNull();
    expect(offerDeadline('garbage', new Date())).toBeNull();
  });

  it('formats the countdown in hours and minutes, never negative', () => {
    expect(formatCountdown(47 * 3_600_000 + 59 * 60_000 + 30_000)).toBe('47h 59m');
    expect(formatCountdown(3 * 3_600_000 + 5 * 60_000)).toBe('3h 05m');
    expect(formatCountdown(-1000)).toBe('0h 00m');
  });
});

describe('Checkout carries the guarantee for offer_v2 only', () => {
  const base = {
    plan: 'monthly' as const,
    priceId: 'price_1',
    userId: 'user-1',
    customerId: null,
    email: 'a@example.com',
    origin: 'https://app.example',
    withTrial: false,
    nowSeconds: 1_000_000,
  };

  it('offer_v2: custom_text.submit.message and metadata.offer_variant', () => {
    const params = buildCheckoutSessionParams({ ...base, offerVariant: 'offer_v2' });
    expect(params.custom_text?.submit).toEqual({ message: guaranteeLine() });
    expect(params.metadata?.offer_variant).toBe('offer_v2');
  });

  it('control: no custom text', () => {
    const params = buildCheckoutSessionParams({ ...base, offerVariant: 'control' });
    expect(params.custom_text).toBeUndefined();
    expect(params.metadata?.offer_variant).toBe('control');
  });
});

describe('<OfferV2Plans />', () => {
  afterEach(() => cleanup());

  const plans = offerPlanCopy(pricingCatalog('standard'), { price: '$5.00', percentOff: 50 });

  it('lists annual first, hides the Deadline Pass behind the downsell link, and shows the countdown and guarantee', () => {
    const onRevealPass = vi.fn();
    render(
      <OfferV2Plans
        plans={plans}
        plan="annual"
        onPlanChange={() => {}}
        deadlineMsLeft={3 * 3_600_000}
        deadlineLabel="50% off your first month"
        proofCount={10}
        passRevealed={false}
        onRevealPass={onRevealPass}
      />
    );
    const radios = screen.getAllByRole('radio').map((r) => r.getAttribute('aria-label'));
    expect(radios).toEqual(['Annual', 'Monthly', 'Semester pass']);
    expect(screen.getByRole('status').textContent).toBe('50% off your first month: ends in 3h 00m');
    expect(screen.getByText(/money-back guarantee/)).toBeTruthy();
    // Below the threshold: no proof line.
    expect(screen.queryByText(/documents started/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Only need it for one deadline?' }));
    expect(onRevealPass).toHaveBeenCalledTimes(1);
  });

  it('no countdown once the deadline has passed', () => {
    render(
      <OfferV2Plans
        plans={plans}
        plan="deadline_pass"
        onPlanChange={() => {}}
        deadlineMsLeft={-5}
        deadlineLabel="50% off your first month"
        passRevealed
        onRevealPass={() => {}}
      />
    );
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.getByRole('radio', { name: 'Deadline Pass' }).getAttribute('aria-checked')).toBe('true');
  });
});
