import { describe, it, expect, vi, beforeEach } from 'vitest';
import type Stripe from 'stripe';

import { DEADLINE_PASS_PRICE, PRO_MONTHLY_EDIT_LIMIT, PRO_PASS_DAYS } from '@/data/constants';
import { pricingCatalog } from '@/lib/pricing-catalog';
import { REGIONAL_AMOUNT_CENTS } from '@/lib/regional-pricing';
import {
  PRICE_DEFINITIONS,
  PRICE_LOOKUP_KEYS,
  getOrCreatePrice,
  resetPriceCacheForTests,
  type PriceClient,
} from '@/lib/stripe-prices';
import { buildCheckoutSessionParams, resolveCheckoutPlan } from '@/lib/checkout-plans';
import {
  grantProPass,
  isProPassSession,
  proPassDaysFromSession,
  revokeProPassForPaymentIntent,
} from '@/lib/stripe-webhook';
import { hasLiveSubscription, passTrialEnd } from '@/lib/subscription/pass-trial';
import { checkoutRecoveryEmail } from '@/lib/email/lifecycle';
import { boughtPassSince } from '@/lib/lifecycle/billing-send';
import {
  entitlementFromStatusResponse,
  proEntitlement,
  proPassActive,
  usesProQuota,
} from '@/lib/subscription/entitlement';
import { canUseFeature, toFeatureUsage } from '@/lib/subscription/features';
import { decideAllowance, remainingAllowance } from '@/lib/usage/allowance';
import { hasFinishedOnboarding, shouldRedirectToOnboarding } from '@/lib/onboarding/paywall-gate';
import { firstPurchaseOfferFor } from '@/lib/first-purchase-offer';
import { eligibleSince, isEntitledToPro, type LifecycleUserRow } from '@/lib/lifecycle/select';

vi.mock('@/lib/reddit-capi', () => ({
  trackRedditConversion: vi.fn().mockResolvedValue(undefined),
}));

const NOW = new Date('2026-11-26T12:00:00Z');
const FUTURE = '2026-11-30T12:00:00Z';
const PAST = '2026-11-20T12:00:00Z';

describe('Deadline Pass price', () => {
  it('is $4.99 for 7 days at the list price, matching the Stripe definition', () => {
    expect(PRO_PASS_DAYS).toBe(7);
    expect(PRICE_LOOKUP_KEYS.deadline_pass).toBe('octree_deadline_pass_7d');
    expect(PRICE_DEFINITIONS.octree_deadline_pass_7d.unitAmount).toBe(Math.round(DEADLINE_PASS_PRICE.amount * 100));
    expect(PRICE_DEFINITIONS.octree_deadline_pass_7d.recurring).toBeUndefined();
    expect(pricingCatalog('standard').deadlinePass).toEqual({ amount: 4.99, price: '$4.99', days: 7 });
  });

  it('follows the regional ratios of the other $4.99 one-off (export_single) in every tier', () => {
    expect(REGIONAL_AMOUNT_CENTS.deadline_pass).toEqual(REGIONAL_AMOUNT_CENTS.export_single);
    expect(pricingCatalog('tier2').deadlinePass).toEqual({ amount: 2.99, price: '$2.99', days: 7 });
    expect(pricingCatalog('tier3').deadlinePass).toEqual({ amount: 1.99, price: '$1.99', days: 7 });
  });

  describe('getOrCreatePrice', () => {
    beforeEach(() => resetPriceCacheForTests());

    function fakeClient() {
      const created: Stripe.PriceCreateParams[] = [];
      const client = {
        prices: {
          list: vi.fn(async () => ({ data: [] })),
          create: vi.fn(async (params: Stripe.PriceCreateParams) => {
            created.push(params);
            return { id: `price_${created.length}`, product: 'prod_pass' } as unknown as Stripe.Price;
          }),
          retrieve: vi.fn(async (id: string) => ({ id, product: 'prod_pass' })),
        },
      } as unknown as PriceClient;
      return { client, created };
    }

    it('creates the list price as a one-time price under its lookup key', async () => {
      const { client, created } = fakeClient();
      await getOrCreatePrice('octree_deadline_pass_7d', client);
      expect(created[0]).toMatchObject({ lookup_key: 'octree_deadline_pass_7d', unit_amount: 499, currency: 'usd' });
      expect(created[0].recurring).toBeUndefined();
    });

    it('creates the tier3 price at $1.99 on the list price product', async () => {
      const { client, created } = fakeClient();
      await getOrCreatePrice('octree_deadline_pass_7d', client, 'tier3');
      const regional = created.find((p) => p.lookup_key === 'octree_deadline_pass_7d__tier3');
      expect(regional).toMatchObject({ unit_amount: 199, product: 'prod_pass' });
      expect(regional?.metadata).toMatchObject({ octree_plan: 'octree_deadline_pass_7d', octree_price_tier: 'tier3' });
    });
  });
});

describe('Deadline Pass checkout', () => {
  it('is a plan the checkout route accepts, with a successPath', () => {
    expect(resolveCheckoutPlan({ plan: 'deadline_pass', source: 'onboarding', successPath: '/generate' })).toEqual({
      ok: true,
      plan: 'deadline_pass',
      withTrial: false,
      source: 'onboarding',
      successPath: '/generate',
    });
  });

  it('opens a payment-mode session that carries the pass days and continues to successPath', () => {
    const params = buildCheckoutSessionParams({
      plan: 'deadline_pass',
      priceId: 'price_pass',
      userId: 'user-1',
      customerId: null,
      email: 'a@example.com',
      origin: 'https://app.example',
      withTrial: true,
      source: 'onboarding',
      successPath: '/projects/p1',
      nowSeconds: 1_000_000,
    });
    expect(params.mode).toBe('payment');
    expect(params.metadata).toMatchObject({ app: 'octree', user_id: 'user-1', plan: 'deadline_pass', pro_pass_days: '7' });
    expect(params.metadata).not.toHaveProperty('credits');
    expect(params.subscription_data).toBeUndefined();
    expect(params.payment_intent_data?.metadata).toMatchObject({ plan: 'deadline_pass' });
    expect(params.success_url).toBe(
      'https://app.example/success?session_id={CHECKOUT_SESSION_ID}&next=%2Fprojects%2Fp1'
    );
  });
});

function passSession(overrides: Record<string, unknown> = {}) {
  return {
    id: 'cs_pass_1',
    mode: 'payment',
    payment_status: 'paid',
    amount_total: 499,
    currency: 'usd',
    metadata: { app: 'octree', user_id: 'user-1', plan: 'deadline_pass', pro_pass_days: '7' },
    ...overrides,
  } as unknown as Stripe.Checkout.Session;
}

/**
 * An in-memory grant_pro_pass with the migration's semantics: one ledger row
 * per session, stacking from max(pro_until, now). Lets the TS side be tested
 * for idempotency and stacking end to end; the SQL itself is covered by
 * supabase/tests/deadline_pass.test.sql.
 */
function fakeDatabase(now: Date, proUntil: string | null = null) {
  const ledger = new Set<string>();
  const state = { proUntil };
  const rpc = vi.fn(async (name: string, args: Record<string, any>) => {
    expect(name).toBe('grant_pro_pass');
    if (ledger.has(args.p_checkout_session_id)) return { data: null, error: null };
    ledger.add(args.p_checkout_session_id);
    const base = Math.max(state.proUntil ? Date.parse(state.proUntil) : 0, now.getTime());
    state.proUntil = new Date(base + args.p_days * 86_400_000).toISOString();
    return { data: state.proUntil, error: null };
  });
  return { client: { rpc } as any, rpc, state };
}

describe('grantProPass (webhook and /success)', () => {
  it('reads the days only from a paid payment-mode session', () => {
    expect(proPassDaysFromSession(passSession())).toBe(7);
    expect(proPassDaysFromSession(passSession({ payment_status: 'unpaid' }))).toBe(0);
    expect(proPassDaysFromSession(passSession({ mode: 'subscription' }))).toBe(0);
    expect(proPassDaysFromSession(passSession({ metadata: { user_id: 'u', pro_pass_days: 'x' } }))).toBe(0);
    expect(proPassDaysFromSession(passSession({ metadata: { user_id: 'u', pro_pass_days: '9999' } }))).toBe(0);
    expect(proPassDaysFromSession(passSession({ metadata: { user_id: 'u', credits: '100' } }))).toBe(0);
  });

  it('extends pro_until by 7 days from now for a first pass', async () => {
    const db = fakeDatabase(NOW);
    const result = await grantProPass(db.client, passSession());
    expect(result).toEqual({ granted: true, userId: 'user-1', days: 7, proUntil: '2026-12-03T12:00:00.000Z' });
    expect(db.rpc).toHaveBeenCalledWith('grant_pro_pass', {
      p_user_id: 'user-1',
      p_checkout_session_id: 'cs_pass_1',
      p_days: 7,
      p_amount_cents: 499,
      p_currency: 'usd',
      p_payment_intent_id: null,
    });
  });

  it('is idempotent per session: a redelivery (or webhook after /success) grants nothing', async () => {
    const db = fakeDatabase(NOW);
    await grantProPass(db.client, passSession());
    const again = await grantProPass(db.client, passSession());
    expect(again).toEqual({ granted: false, reason: 'already_granted' });
    expect(db.state.proUntil).toBe('2026-12-03T12:00:00.000Z');
  });

  it('stacks a second pass onto the end of one still running', async () => {
    const db = fakeDatabase(NOW, FUTURE);
    const result = await grantProPass(db.client, passSession({ id: 'cs_pass_2' }));
    expect(result).toMatchObject({ granted: true, proUntil: '2026-12-07T12:00:00.000Z' });
  });

  it('starts from now when the previous pass has ended', async () => {
    const db = fakeDatabase(NOW, PAST);
    const result = await grantProPass(db.client, passSession({ id: 'cs_pass_3' }));
    expect(result).toMatchObject({ granted: true, proUntil: '2026-12-03T12:00:00.000Z' });
  });

  it('ignores other purchases and sessions without a user, and throws database errors so Stripe retries', async () => {
    const db = fakeDatabase(NOW);
    expect(await grantProPass(db.client, passSession({ metadata: { credits: '100', user_id: 'u' } }))).toEqual({
      granted: false,
      reason: 'not_a_pass_purchase',
    });
    expect(await grantProPass(db.client, passSession({ metadata: { pro_pass_days: '7' } }))).toEqual({
      granted: false,
      reason: 'missing_user',
    });
    expect(db.rpc).not.toHaveBeenCalled();
    const failing = { rpc: vi.fn().mockResolvedValue({ data: null, error: new Error('db down') }) } as any;
    await expect(grantProPass(failing, passSession())).rejects.toThrow('db down');
  });
});

describe('a running pass is Pro everywhere', () => {
  const freeRow = { is_pro: false, subscription_status: 'inactive', stripe_subscription_id: null, current_period_end: null };

  it('proPassActive: only a known future end', () => {
    expect(proPassActive({ pro_until: FUTURE }, NOW)).toBe(true);
    expect(proPassActive({ pro_until: PAST }, NOW)).toBe(false);
    expect(proPassActive({ pro_until: null }, NOW)).toBe(false);
    expect(proPassActive({ pro_until: 'garbage' }, NOW)).toBe(false);
    expect(proPassActive(null, NOW)).toBe(false);
  });

  it('proEntitlement (subscription-status, ATS, claim-free-export, API resolvePlan)', () => {
    expect(proEntitlement({ row: { ...freeRow, pro_until: FUTURE }, hasUnlimited: false, now: NOW })).toEqual({
      isPro: true,
      source: 'pass',
    });
    expect(proEntitlement({ row: { ...freeRow, pro_until: PAST }, hasUnlimited: false, now: NOW }).isPro).toBe(false);
    // Stripe says the subscription is gone: the separately-paid pass still counts.
    expect(
      proEntitlement({ row: { ...freeRow, pro_until: FUTURE }, stripeStatus: 'canceled', hasUnlimited: false, now: NOW })
    ).toEqual({ isPro: true, source: 'pass' });
  });

  it('entitlementFromStatusResponse / toFeatureUsage / canUseFeature (client gates)', () => {
    const response = {
      hasSubscription: false,
      usage: {
        isPro: true,
        hasUnlimitedEdits: false,
        limitReached: false,
        monthlyLimitReached: false,
        subscriptionStatus: 'inactive',
        currentPeriodEnd: null,
        hasStripeSubscription: false,
        stripeStatus: null,
        proUntil: FUTURE,
      },
    };
    expect(entitlementFromStatusResponse(response, NOW)).toEqual({ isPro: true, source: 'pass' });
    expect(entitlementFromStatusResponse({ ...response, usage: { ...response.usage, proUntil: PAST } }, NOW).isPro).toBe(
      false
    );
    const usage = toFeatureUsage(response);
    expect(usage?.isPro).toBe(true);
    expect(canUseFeature(usage, 'export')).toEqual({ allowed: true });
    expect(canUseFeature(usage, 'ats')).toEqual({ allowed: true });
  });

  it('usesProQuota + the allowance: the Pro monthly allowance while the pass runs', () => {
    const row = { is_pro: false, pro_until: FUTURE };
    expect(usesProQuota(row, NOW)).toBe(true);
    expect(usesProQuota({ is_pro: false, pro_until: PAST }, NOW)).toBe(false);
    expect(usesProQuota({ is_pro: true, pro_until: null }, NOW)).toBe(true);
    const usage = { edit_count: 5, monthly_edit_count: 10, edit_credits: 0 };
    expect(decideAllowance(usage, usesProQuota(row, NOW), NOW)).toBe('pro');
    expect(remainingAllowance(usage, usesProQuota(row, NOW), NOW)).toBe(PRO_MONTHLY_EDIT_LIMIT - 10);
    expect(decideAllowance(usage, usesProQuota({ is_pro: false, pro_until: PAST }, NOW), NOW)).toBe('blocked');
  });

  it('hasFinishedOnboarding (onboarding paywall gate)', () => {
    expect(hasFinishedOnboarding({ onboarding_completed: false, is_pro: false, pro_until: FUTURE }, true, NOW)).toBe(true);
    expect(hasFinishedOnboarding({ onboarding_completed: false, is_pro: false, pro_until: PAST }, true, NOW)).toBe(false);
    expect(shouldRedirectToOnboarding({ onboarding_completed: false, pro_until: FUTURE }, 'app', true)).toBe(false);
  });

  it('firstPurchaseOfferFor: a pass buyer is not a first purchase, running or not', () => {
    expect(firstPurchaseOfferFor({ ...freeRow, pro_until: PAST }, NOW, { env: {} })).toBeNull();
    expect(firstPurchaseOfferFor({ ...freeRow, pro_until: null }, NOW, { env: {} })).toBe('welcome50');
  });

  it('lifecycle: Pro while the pass runs, and no upsell or inactivity email', () => {
    const user: LifecycleUserRow = {
      userId: 'u1',
      email: 'a@example.com',
      createdAt: '2026-11-25T12:00:00Z',
      editCount: 5,
      dailyResetDate: '2026-11-26',
      isPro: false,
      subscriptionStatus: 'inactive',
      stripeCustomerId: null,
      proUntil: FUTURE,
      role: null,
      firstProjectAt: null,
      subscriptionEndedAt: null,
      lastActivityAt: '2026-11-10T12:00:00Z',
      lastPaywallHit: { createdAt: '2026-11-25T12:00:00Z' },
      hasOneOffPurchase: false,
    } as LifecycleUserRow;
    expect(isEntitledToPro(user, NOW)).toBe(true);
    for (const template of ['welcome', 'limit_hit', 'day7', 'winback', 'warm_lead_offer', 'pro_inactive'] as const) {
      expect(eligibleSince(user, template, NOW)).toBeNull();
    }
    expect(isEntitledToPro({ ...user, proUntil: PAST }, NOW)).toBe(false);
  });
});

describe('review fixes: pass sessions, refunds, checkout and copy', () => {
  it('a no_payment_required pass session is granted; the metadata alone marks a pass', () => {
    expect(proPassDaysFromSession(passSession({ payment_status: 'no_payment_required' }))).toBe(7);
    expect(isProPassSession(passSession({ payment_status: 'unpaid' }))).toBe(true);
    expect(isProPassSession(passSession({ metadata: { credits: '100' } }))).toBe(false);
    expect(isProPassSession(passSession({ mode: 'subscription' }))).toBe(false);
  });

  it('stores the payment intent on the ledger at grant time', async () => {
    const db = fakeDatabase(NOW);
    await grantProPass(db.client, passSession({ payment_intent: { id: 'pi_1' } }));
    expect(db.rpc.mock.calls[0][1]).toMatchObject({ p_payment_intent_id: 'pi_1' });
  });

  describe('revokeProPassForPaymentIntent (charge.refunded / charge.dispute.created)', () => {
    function db(row: { checkout_session_id: string; user_id: string } | null, rpcData: string | null) {
      const maybeSingle = vi.fn().mockResolvedValue({ data: row, error: null });
      const eq = vi.fn().mockReturnValue({ maybeSingle });
      const from = vi.fn().mockReturnValue({ select: () => ({ eq }) });
      const rpc = vi.fn().mockResolvedValue({ data: rpcData, error: null });
      return { client: { from, rpc } as any, from, eq, rpc };
    }
    const noStripe = { checkout: { sessions: { list: vi.fn().mockResolvedValue({ data: [] }) } } };

    it('finds the pass by payment intent and revokes it', async () => {
      const d = db({ checkout_session_id: 'cs_pass_1', user_id: 'user-1' }, '2026-11-28T12:00:00Z');
      const result = await revokeProPassForPaymentIntent(d.client, noStripe, 'pi_1', 'refund');
      expect(d.eq).toHaveBeenCalledWith('payment_intent_id', 'pi_1');
      expect(d.rpc).toHaveBeenCalledWith('revoke_pro_pass', { p_checkout_session_id: 'cs_pass_1', p_reason: 'refund' });
      expect(result).toEqual({ revoked: true, userId: 'user-1', sessionId: 'cs_pass_1', proUntil: '2026-11-28T12:00:00Z' });
    });

    it('is idempotent: a redelivered refund revokes nothing', async () => {
      const d = db({ checkout_session_id: 'cs_pass_1', user_id: 'user-1' }, null);
      expect(await revokeProPassForPaymentIntent(d.client, noStripe, 'pi_1', 'dispute')).toEqual({
        revoked: false,
        reason: 'already_revoked',
      });
    });

    it('falls back to the Checkout Session of the payment intent for a ledger row without it', async () => {
      const d = db(null, '2026-11-26T12:00:00Z');
      const stripe = {
        checkout: { sessions: { list: vi.fn().mockResolvedValue({ data: [passSession({ id: 'cs_old' })] }) } },
      };
      const result = await revokeProPassForPaymentIntent(d.client, stripe, 'pi_old', 'refund');
      expect(stripe.checkout.sessions.list).toHaveBeenCalledWith({ payment_intent: 'pi_old', limit: 1 });
      expect(result).toMatchObject({ revoked: true, sessionId: 'cs_old', userId: 'user-1' });
    });

    it('leaves anything that is not an Octree pass alone', async () => {
      const d = db(null, null);
      const stripe = {
        checkout: {
          sessions: {
            list: vi.fn().mockResolvedValue({ data: [passSession({ metadata: { app: 'octree', user_id: 'u', credits: '100' } })] }),
          },
        },
      };
      expect(await revokeProPassForPaymentIntent(d.client, stripe, 'pi_x', 'refund')).toEqual({
        revoked: false,
        reason: 'not_a_pass',
      });
      expect(await revokeProPassForPaymentIntent(d.client, noStripe, 'pi_y', 'refund')).toEqual({
        revoked: false,
        reason: 'not_a_pass',
      });
      expect(d.rpc).not.toHaveBeenCalled();
    });
  });

  it('pass checkouts take no promotion codes, on the session or the recovery link', () => {
    const params = buildCheckoutSessionParams({
      plan: 'deadline_pass',
      priceId: 'price_pass',
      userId: 'user-1',
      customerId: null,
      email: null,
      origin: 'https://app.example',
      withTrial: false,
      nowSeconds: 1_000_000,
    });
    expect(params.allow_promotion_codes).toBe(false);
    expect(params.after_expiration).toEqual({ recovery: { enabled: true, allow_promotion_codes: false } });
  });

  it('a subscription bought during a pass starts billing at the pass end (trial_end)', () => {
    const params = buildCheckoutSessionParams({
      plan: 'monthly',
      priceId: 'price_m',
      userId: 'user-1',
      customerId: null,
      email: null,
      origin: 'https://app.example',
      withTrial: true,
      trialEnd: 1_800_000_000,
      nowSeconds: 1_000_000,
    });
    expect(params.subscription_data?.trial_end).toBe(1_800_000_000);
    expect(params.subscription_data?.trial_period_days).toBeUndefined();
  });

  it('passTrialEnd: only a pass ending more than 48 hours out', () => {
    expect(passTrialEnd('2026-11-30T12:00:00Z', NOW)).toBe(Date.parse('2026-11-30T12:00:00Z') / 1000);
    expect(passTrialEnd('2026-11-28T11:00:00Z', NOW)).toBeNull();
    expect(passTrialEnd(PAST, NOW)).toBeNull();
    expect(passTrialEnd(null, NOW)).toBeNull();
  });

  it('hasLiveSubscription: only active/trialing within the period blocks a pass', () => {
    const row = { stripe_subscription_id: 'sub_1', current_period_end: FUTURE, pro_until: null };
    expect(hasLiveSubscription({ ...row, subscription_status: 'active' }, NOW)).toBe(true);
    expect(hasLiveSubscription({ ...row, subscription_status: 'trialing' }, NOW)).toBe(true);
    for (const status of ['past_due', 'unpaid', 'incomplete', 'canceled', 'paused']) {
      expect(hasLiveSubscription({ ...row, subscription_status: status }, NOW)).toBe(false);
    }
    expect(hasLiveSubscription({ ...row, subscription_status: 'active', current_period_end: PAST }, NOW)).toBe(false);
    expect(hasLiveSubscription({ ...row, subscription_status: 'active', stripe_subscription_id: null }, NOW)).toBe(false);
  });

  it('after the pass ends the user is not sent back to /onboarding (grant_pro_pass set onboarding_completed)', () => {
    // Both grant paths (webhook and /success) go through grant_pro_pass,
    // which sets onboarding_completed (supabase/tests/deadline_pass.test.sql).
    const afterPass = { onboarding_completed: true, is_pro: false, pro_until: PAST };
    expect(hasFinishedOnboarding(afterPass, true, NOW)).toBe(true);
    expect(shouldRedirectToOnboarding(afterPass, 'app', true)).toBe(false);
    expect(shouldRedirectToOnboarding(afterPass, 'dashboard', true)).toBe(false);
  });

  it('checkout recovery emails describe the pass as a one-off', () => {
    const email = checkoutRecoveryEmail({
      recoveryUrl: 'https://checkout.stripe.com/r',
      plan: 'deadline_pass',
      amountCents: 199,
      currency: 'usd',
      promoCode: null,
      unsubscribeUrl: 'https://app.example/u',
    });
    expect(email.text).toContain('the Octree Deadline Pass (7 days of Pro, $1.99 once)');
    expect(email.text).toContain('nothing renews');
    expect(email.text).not.toContain('Cancel anytime');
  });
});

describe('boughtPassSince (checkout recovery skip)', () => {
  function supabaseWith(result: { data: unknown[] | null; error: unknown }) {
    const limit = vi.fn().mockResolvedValue(result);
    const gte = vi.fn().mockReturnValue({ limit });
    const eq = vi.fn().mockReturnValue({ gte });
    return { client: { from: vi.fn().mockReturnValue({ select: () => ({ eq }) }) } as any, gte };
  }

  it('is true when a pass was bought after the checkout opened', async () => {
    const s = supabaseWith({ data: [{ id: 1 }], error: null });
    await expect(boughtPassSince(s.client, 'user-1', Date.parse('2026-11-25T00:00:00Z'))).resolves.toBe(true);
    expect(s.gte).toHaveBeenCalledWith('created_at', '2026-11-25T00:00:00.000Z');
  });

  it('is false with no purchase, or when the ledger cannot be read (never loses a reminder)', async () => {
    await expect(boughtPassSince(supabaseWith({ data: [], error: null }).client, 'u', 0)).resolves.toBe(false);
    await expect(
      boughtPassSince(supabaseWith({ data: null, error: { code: '42P01' } }).client, 'u', 0)
    ).resolves.toBe(false);
  });
});
