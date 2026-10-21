import { describe, it, expect, vi, beforeEach } from 'vitest';

import { enteredDelinquency } from '@/lib/stripe-webhook';
import {
  CHECKOUT_OFFER_DELAY_MS,
  PAYMENT_FAILED_REMINDER_DELAY_MS,
  describeAbandonedCheckout,
  describeFailedInvoice,
  latestInvoiceId,
  selectBillingFollowUps,
  usageRowHasSubscription,
  withPromoCode,
  type BillingLedgerRow,
} from '@/lib/lifecycle/billing-recovery';
import {
  ensureComebackPromoCode,
  resetComebackPromoCodeForTests,
  runBillingFollowUps,
  sendCheckoutRecoveryEmail,
  sendPaymentFailedEmail,
} from '@/lib/lifecycle/billing-send';
import { LifecycleLedgerUnavailableError, type LifecycleSendDeps } from '@/lib/lifecycle/send';
import {
  checkoutRecoveryEmail,
  checkoutRecoveryOfferEmail,
  formatMoney,
  paymentFailedEmail,
  paymentFailedReminderEmail,
} from '@/lib/email/lifecycle';

/**
 * Billing recovery (lib/lifecycle/billing-recovery.ts, billing-send.ts):
 * the transition that triggers dunning, what an expired session yields,
 * which follow-ups are due, and the send functions against an in-memory
 * ledger. The route-level behaviour (Stripe webhook) is in
 * stripe-webhook-route.test.ts.
 */

function updated(object: Record<string, unknown>, previous?: Record<string, unknown>) {
  return {
    type: 'customer.subscription.updated',
    data: { object: { id: 'sub_1', status: 'active', ...object } as any, previous_attributes: previous as any },
  };
}

describe('enteredDelinquency', () => {
  it('is true only for the update that moves into past_due / unpaid from a non-delinquent status', () => {
    expect(enteredDelinquency(updated({ status: 'past_due' }, { status: 'active' }))).toBe(true);
    expect(enteredDelinquency(updated({ status: 'unpaid' }, { status: 'trialing' }))).toBe(true);
    expect(enteredDelinquency(updated({ status: 'past_due' }, { status: 'incomplete' }))).toBe(true);
  });

  it('is false for retries, recoveries, unpaid after past_due, and other events', () => {
    expect(enteredDelinquency(updated({ status: 'past_due' }, { metadata: {} }))).toBe(false);
    expect(enteredDelinquency(updated({ status: 'past_due' }))).toBe(false);
    expect(enteredDelinquency(updated({ status: 'active' }, { status: 'past_due' }))).toBe(false);
    expect(enteredDelinquency(updated({ status: 'unpaid' }, { status: 'past_due' }))).toBe(false);
    expect(enteredDelinquency(updated({ status: 'canceled' }, { status: 'past_due' }))).toBe(false);
    expect(
      enteredDelinquency({ ...updated({ status: 'past_due' }, { status: 'active' }), type: 'customer.subscription.created' })
    ).toBe(false);
  });
});

describe('invoice and session helpers', () => {
  it('reads the latest invoice id whether expanded or not', () => {
    expect(latestInvoiceId({ latest_invoice: 'in_1' })).toBe('in_1');
    expect(latestInvoiceId({ latest_invoice: { id: 'in_2' } as any })).toBe('in_2');
    expect(latestInvoiceId({ latest_invoice: null })).toBeNull();
  });

  it('describes a failed invoice, preferring the remaining amount', () => {
    expect(
      describeFailedInvoice({
        id: 'in_1',
        amount_due: 999,
        amount_remaining: 500,
        currency: 'usd',
        hosted_invoice_url: 'https://invoice.stripe.com/i/in_1',
        next_payment_attempt: 123,
        status: 'open',
      })
    ).toEqual({
      invoiceId: 'in_1',
      amountCents: 500,
      currency: 'usd',
      hostedInvoiceUrl: 'https://invoice.stripe.com/i/in_1',
      nextPaymentAttempt: 123,
      status: 'open',
    });
    expect(describeFailedInvoice({ id: 'in_2' })).toMatchObject({ amountCents: null, nextPaymentAttempt: null, hostedInvoiceUrl: null });
  });

  it('describes an expired session, null without a user id', () => {
    expect(
      describeAbandonedCheckout({
        id: 'cs_1',
        mode: 'subscription',
        metadata: { user_id: 'u1', plan: 'annual' },
        amount_total: 7900,
        currency: 'usd',
        customer: { id: 'cus_1' } as any,
        after_expiration: { recovery: { enabled: true, allow_promotion_codes: true, url: 'https://r/1', expires_at: 99 } },
      })
    ).toEqual({
      sessionId: 'cs_1',
      userId: 'u1',
      plan: 'annual',
      mode: 'subscription',
      amountCents: 7900,
      currency: 'usd',
      customerId: 'cus_1',
      recoveryUrl: 'https://r/1',
      recoveryExpiresAt: 99,
    });
    expect(describeAbandonedCheckout({ id: 'cs_2', mode: 'payment', metadata: {} })).toBeNull();
    expect(describeAbandonedCheckout({ id: 'cs_3', mode: 'payment', metadata: { user_id: 'u1' } })).toMatchObject({
      recoveryUrl: null,
      customerId: null,
    });
  });

  it('appends the promotion code to the recovery URL', () => {
    expect(withPromoCode('https://checkout.stripe.com/c/pay/x', 'COMEBACK50')).toBe(
      'https://checkout.stripe.com/c/pay/x?prefilled_promo_code=COMEBACK50'
    );
    expect(withPromoCode('https://x/y?a=1', 'C')).toBe('https://x/y?a=1&prefilled_promo_code=C');
    expect(withPromoCode('https://x/y', null)).toBe('https://x/y');
  });

  it('reads a subscription relationship off a user_usage row', () => {
    expect(usageRowHasSubscription(null)).toBe(false);
    expect(usageRowHasSubscription({ is_pro: false, subscription_status: 'inactive' })).toBe(false);
    expect(usageRowHasSubscription({ is_pro: false, subscription_status: 'past_due' })).toBe(true);
    expect(usageRowHasSubscription({ is_pro: true, subscription_status: null })).toBe(true);
  });
});

describe('selectBillingFollowUps', () => {
  const t0 = Date.UTC(2026, 9, 1, 12, 0, 0);
  const row = (over: Partial<BillingLedgerRow>): BillingLedgerRow => ({
    userId: 'u1',
    email: 'a@example.com',
    template: 'payment_failed',
    ref: 'in_1',
    payload: { subscription_id: 'sub_1', invoice_id: 'in_1' },
    sentAt: new Date(t0).toISOString(),
    resendId: 'msg_1',
    error: null,
    ...over,
  });
  const recovery = (over: Partial<BillingLedgerRow> = {}) =>
    row({
      template: 'checkout_recovery',
      ref: 'cs_1',
      payload: { recovery_url: 'https://r/1', mode: 'subscription', plan: 'monthly' },
      ...over,
    });

  it('a reminder is due 5 days after a delivered notice, an offer 48h after a delivered recovery email', () => {
    const rows = [row({}), recovery()];
    expect(selectBillingFollowUps(rows, new Date(t0 + CHECKOUT_OFFER_DELAY_MS - 1))).toEqual([]);
    expect(selectBillingFollowUps(rows, new Date(t0 + CHECKOUT_OFFER_DELAY_MS)).map((f) => f.template)).toEqual([
      'checkout_recovery_offer',
    ]);
    const both = selectBillingFollowUps(rows, new Date(t0 + PAYMENT_FAILED_REMINDER_DELAY_MS));
    expect(both.map((f) => f.template)).toEqual(['checkout_recovery_offer', 'payment_failed_reminder']);
    expect(both[1]).toMatchObject({ userId: 'u1', ref: 'in_1', eligibleSince: t0 + PAYMENT_FAILED_REMINDER_DELAY_MS });
  });

  it('never selects a follow-up twice: any existing follow-up row for the key blocks it, even a failed one', () => {
    const later = new Date(t0 + 30 * 24 * 3600 * 1000);
    expect(
      selectBillingFollowUps([row({}), row({ template: 'payment_failed_reminder', resendId: null, error: 'boom' })], later)
    ).toEqual([]);
    // A different invoice is a different delinquency: due again.
    expect(
      selectBillingFollowUps(
        [row({}), row({ template: 'payment_failed_reminder' }), row({ ref: 'in_2', payload: { subscription_id: 'sub_1' } })],
        later
      ).map((f) => f.ref)
    ).toEqual(['in_2']);
  });

  it('skips undelivered first emails, one-off carts and expired recovery URLs', () => {
    const later = new Date(t0 + 30 * 24 * 3600 * 1000);
    expect(selectBillingFollowUps([row({ resendId: null, error: 'bounced' })], later)).toEqual([]);
    expect(selectBillingFollowUps([recovery({ payload: { recovery_url: 'https://r/1', mode: 'payment' } })], later)).toEqual([]);
    expect(
      selectBillingFollowUps(
        [recovery({ payload: { recovery_url: 'https://r/1', mode: 'subscription', recovery_expires_at: Math.floor(later.getTime() / 1000) - 1 } })],
        later
      )
    ).toEqual([]);
    expect(selectBillingFollowUps([row({ payload: null })], later)).toEqual([]);
  });
});

describe('billing recovery templates', () => {
  const failed = {
    amountCents: 999,
    currency: 'usd',
    hostedInvoiceUrl: 'https://invoice.stripe.com/i/in_1',
    nextPaymentAttempt: Date.UTC(2026, 9, 21) / 1000,
    billingUrl: 'https://app.example.com/settings',
  };

  it('payment_failed names the amount, the retry date, the invoice and the portal, and has no unsubscribe link', () => {
    const { subject, html, text } = paymentFailedEmail(failed);
    expect(subject).toBe("Your Octree Pro payment didn't go through");
    expect(text).toContain('$9.99');
    expect(text).toContain('October 21');
    // Stripe-hosted pages are linked as issued; Octree links carry the campaign tag.
    expect(html).toContain('href="https://invoice.stripe.com/i/in_1"');
    expect(html).toContain('href="https://app.example.com/settings?utm_source=lifecycle&amp;utm_medium=email&amp;utm_campaign=payment_failed"');
    expect(text).not.toContain('Unsubscribe');
    expect(html).not.toContain('Unsubscribe');
    expect(html.match(/border-radius:8px/g)).toHaveLength(1);
  });

  it('both dunning emails say that someone who no longer needs Octree can do nothing and it lapses', () => {
    expect(paymentFailedEmail(failed).text).toContain('If you no longer need Octree, cancel from Settings so we stop retrying the card');
    expect(paymentFailedReminderEmail(failed).text).toContain('ignore this and the subscription will end on its own');
  });

  it('payment_failed falls back to the portal and says so when no retry is scheduled', () => {
    const { html, text } = paymentFailedReminderEmail({ ...failed, hostedInvoiceUrl: null, nextPaymentAttempt: null });
    expect(text).toContain('no further automatic retry');
    expect(html).toContain('href="https://app.example.com/settings?utm_source=lifecycle&amp;utm_medium=email&amp;utm_campaign=payment_failed_reminder"');
    expect(html).not.toContain('invoice.stripe.com');
  });

  it('checkout_recovery carries the recovery URL and the unsubscribe link; the offer adds the code', () => {
    const base = {
      recoveryUrl: 'https://checkout.stripe.com/c/pay/x',
      plan: 'monthly',
      amountCents: 999,
      currency: 'usd',
      promoCode: null,
      unsubscribeUrl: 'https://app.example.com/api/email/unsubscribe?token=t',
    };
    const first = checkoutRecoveryEmail(base);
    expect(first.html).toContain('href="https://checkout.stripe.com/c/pay/x"');
    expect(first.text).toContain('Unsubscribe: https://app.example.com/api/email/unsubscribe?token=t');
    expect(first.text).toContain('$9.99/month');

    const offer = checkoutRecoveryOfferEmail({ ...base, promoCode: 'COMEBACK50', recoveryUrl: withPromoCode(base.recoveryUrl, 'COMEBACK50') });
    expect(offer.subject).toBe('Half price for two months of Octree Pro');
    expect(offer.text).toContain('COMEBACK50');
    expect(offer.html).toContain('prefilled_promo_code=COMEBACK50');

    const noOffer = checkoutRecoveryOfferEmail(base);
    expect(noOffer.subject).toBe('Still thinking about Octree Pro?');
    expect(noOffer.text).not.toContain('COMEBACK');
  });

  it('formats money', () => {
    expect(formatMoney(999, 'usd')).toBe('$9.99');
    expect(formatMoney(7900, 'USD')).toBe('$79.00');
    expect(formatMoney(null, 'usd')).toBeNull();
    expect(formatMoney(1000, 'eur')).toContain('10.00');
  });
});

// --- Send functions against an in-memory ledger -------------------------------------

function fakeDeps(options: { ledgerUnavailable?: boolean; mayEmail?: boolean } = {}) {
  const claimed = new Set<string>();
  const sent: Array<{ to: string; subject: string; html: string }> = [];
  /** Keys closed by markSkipped: `${userId}:${template}:${ref}` with the reason. */
  const skipped: Array<{ key: string; reason: string }> = [];
  const capture = vi.fn();
  const deps: LifecycleSendDeps = {
    mayEmail: async () => options.mayEmail ?? true,
    throttleMs: 0,
    mailer: {
      async send(input) {
        sent.push({ to: input.to, subject: input.subject, html: input.html });
        return { id: `msg_${sent.length}`, error: null };
      },
    },
    ledger: {
      async claim({ userId, template, ref }) {
        if (options.ledgerUnavailable) throw new LifecycleLedgerUnavailableError("column 'ref' missing");
        const key = `${userId}:${template}:${ref}`;
        if (claimed.has(key)) return false;
        claimed.add(key);
        return true;
      },
      async markSent() {},
      async markFailed() {},
      async markSkipped({ userId, template, ref, reason }) {
        const key = `${userId}:${template}:${ref}`;
        if (claimed.has(key)) return;
        claimed.add(key);
        skipped.push({ key, reason });
      },
    },
    capture,
    appUrl: 'https://app.example.com',
    toolsUrl: 'https://tools.example.com',
    unsubscribeUrl: (userId) => `https://app.example.com/api/email/unsubscribe?token=${userId}`,
  };
  return { deps, claimed, sent, skipped, capture };
}

function fakeSupabase(options: {
  email?: string | null;
  usage?: { is_pro: boolean; subscription_status: string | null; stripe_customer_id?: string | null } | null;
  ledgerRows?: Array<Record<string, unknown>>;
  ledgerError?: { code: string; message: string } | null;
  /** Rows the checkout-recovery cooldown query finds (delivered recovery emails in the window). */
  recentRecoveryRows?: Array<Record<string, unknown>>;
}) {
  /**
   * The two lifecycle_emails reads: the follow-up loader
   * (select.in.order.limit) and the recovery cooldown
   * (select.eq.in.not.gte.limit). A chain that filtered on user_id is the
   * cooldown one.
   */
  function ledgerQuery() {
    let byUser = false;
    const chain: any = {
      select: () => chain,
      eq: (column: string) => {
        if (column === 'user_id') byUser = true;
        return chain;
      },
      in: () => chain,
      not: () => chain,
      gte: () => chain,
      order: () => chain,
      limit: async () =>
        byUser
          ? { data: options.recentRecoveryRows ?? [], error: null }
          : { data: options.ledgerError ? null : options.ledgerRows ?? [], error: options.ledgerError ?? null },
    };
    return chain;
  }
  return {
    auth: { admin: { getUserById: async () => ({ data: { user: options.email === null ? null : { email: options.email ?? 'A@Example.com' } }, error: null }) } },
    from: (table: string) => {
      if (table === 'user_usage') {
        return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: options.usage ?? null, error: null }) }) }) };
      }
      if (table === 'lifecycle_emails') return ledgerQuery();
      throw new Error(`unexpected table ${table}`);
    },
  } as any;
}

describe('sendPaymentFailedEmail', () => {
  const stripe = {
    invoices: {
      retrieve: vi.fn(async (id: string) => ({
        id,
        status: 'open',
        amount_due: 999,
        amount_remaining: 999,
        currency: 'usd',
        hosted_invoice_url: `https://invoice.stripe.com/i/${id}`,
        next_payment_attempt: null,
      })),
    },
  } as any;

  it('sends once per invoice and again for a new invoice', async () => {
    const { deps, sent } = fakeDeps();
    const supabase = fakeSupabase({});
    const subscription = { id: 'sub_1', latest_invoice: 'in_1' } as any;

    const first = await sendPaymentFailedEmail({ stripe, supabase, deps, userId: 'u1', subscription });
    expect(first).toMatchObject({ sent: true, template: 'payment_failed', ref: 'in_1', invoice: { invoiceId: 'in_1', amountCents: 999 } });
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe('a@example.com');

    const again = await sendPaymentFailedEmail({ stripe, supabase, deps, userId: 'u1', subscription });
    expect(again).toMatchObject({ sent: false, reason: 'already sent' });
    expect(sent).toHaveLength(1);

    const next = await sendPaymentFailedEmail({ stripe, supabase, deps, userId: 'u1', subscription: { id: 'sub_1', latest_invoice: 'in_2' } as any });
    expect(next).toMatchObject({ sent: true, ref: 'in_2' });
    expect(sent).toHaveLength(2);
  });

  it('reports ledger_unavailable instead of throwing when the migration is pending', async () => {
    const { deps, sent } = fakeDeps({ ledgerUnavailable: true });
    const result = await sendPaymentFailedEmail({
      stripe,
      supabase: fakeSupabase({}),
      deps,
      userId: 'u1',
      subscription: { id: 'sub_1', latest_invoice: 'in_1' } as any,
    });
    expect(result.sent).toBe(false);
    expect(result.sent === false && result.reason).toMatch(/^ledger_unavailable/);
    expect(sent).toHaveLength(0);
  });

  it('skips a user without an email or a subscription without an invoice', async () => {
    const { deps, sent } = fakeDeps();
    expect(
      await sendPaymentFailedEmail({ stripe, supabase: fakeSupabase({ email: null }), deps, userId: 'u1', subscription: { id: 'sub_1', latest_invoice: 'in_1' } as any })
    ).toMatchObject({ sent: false, reason: 'user has no email' });
    expect(
      await sendPaymentFailedEmail({ stripe, supabase: fakeSupabase({}), deps, userId: 'u1', subscription: { id: 'sub_1', latest_invoice: null } as any })
    ).toMatchObject({ sent: false, reason: 'no latest invoice' });
    expect(sent).toHaveLength(0);
  });
});

describe('sendCheckoutRecoveryEmail', () => {
  const session = {
    id: 'cs_1',
    mode: 'subscription',
    metadata: { user_id: 'u1', plan: 'monthly' },
    amount_total: 999,
    currency: 'usd',
    customer: null,
    after_expiration: { recovery: { enabled: true, allow_promotion_codes: true, url: 'https://r/1', expires_at: 1 } },
  } as any;
  const stripe = { subscriptions: { list: vi.fn(async () => ({ data: [] })) } } as any;

  it('sends once per session with the recovery URL', async () => {
    const { deps, sent } = fakeDeps();
    const supabase = fakeSupabase({ usage: { is_pro: false, subscription_status: 'inactive' } });
    const first = await sendCheckoutRecoveryEmail({ stripe, supabase, deps, session });
    expect(first).toMatchObject({ sent: true, template: 'checkout_recovery', ref: 'cs_1', checkout: { plan: 'monthly' } });
    expect(sent[0].html).toContain('https://r/1');
    const again = await sendCheckoutRecoveryEmail({ stripe, supabase, deps, session });
    expect(again).toMatchObject({ sent: false, reason: 'already sent' });
    expect(sent).toHaveLength(1);
  });

  it('does nothing without a recovery URL', async () => {
    const { deps, sent } = fakeDeps();
    const result = await sendCheckoutRecoveryEmail({
      stripe,
      supabase: fakeSupabase({}),
      deps,
      session: { ...session, after_expiration: null },
    });
    expect(result).toMatchObject({ sent: false, reason: 'no recovery url' });
    expect(sent).toHaveLength(0);
  });

  it('does nothing for someone who already has a subscription (row, or Stripe by customer)', async () => {
    const { deps, sent } = fakeDeps();
    expect(
      await sendCheckoutRecoveryEmail({ stripe, supabase: fakeSupabase({ usage: { is_pro: false, subscription_status: 'past_due' } }), deps, session })
    ).toMatchObject({ sent: false, reason: 'already subscribed' });

    const live = { subscriptions: { list: vi.fn(async () => ({ data: [{ status: 'active' }] })) } } as any;
    expect(
      await sendCheckoutRecoveryEmail({ stripe: live, supabase: fakeSupabase({ usage: null }), deps, session: { ...session, customer: 'cus_1' } })
    ).toMatchObject({ sent: false, reason: 'already subscribed' });
    expect(live.subscriptions.list).toHaveBeenCalledWith({ customer: 'cus_1', status: 'all', limit: 10 });
    expect(sent).toHaveLength(0);
  });

  it('sends at most one recovery sequence per user per cooldown, however many sessions expire', async () => {
    const { deps, sent, claimed } = fakeDeps();
    // A delivered checkout_recovery (for another session) inside the window.
    const supabase = fakeSupabase({
      usage: { is_pro: false, subscription_status: 'inactive' },
      recentRecoveryRows: [{ id: 'row_1' }],
    });

    const result = await sendCheckoutRecoveryEmail({ stripe, supabase, deps, session: { ...session, id: 'cs_2' } });

    expect(result).toMatchObject({ sent: false, ref: 'cs_2', reason: 'recovery email sent recently' });
    expect(sent).toHaveLength(0);
    // No ledger row either, so no offer follows the second session.
    expect(claimed.size).toBe(0);
  });

  it('counts only delivered recovery emails inside the window for the cooldown', async () => {
    const { deps, sent } = fakeDeps();
    const supabase = fakeSupabase({ usage: { is_pro: false, subscription_status: 'inactive' }, recentRecoveryRows: [] });
    expect(await sendCheckoutRecoveryEmail({ stripe, supabase, deps, session })).toMatchObject({ sent: true });
    expect(sent).toHaveLength(1);
  });
});

describe('ensureComebackPromoCode', () => {
  beforeEach(() => resetComebackPromoCodeForTests());

  it('reuses an active promotion code on the save coupon', async () => {
    const stripe = {
      invoices: { retrieve: vi.fn() },
      subscriptions: { retrieve: vi.fn(), list: vi.fn() },
      promotionCodes: { list: vi.fn(async () => ({ data: [{ code: 'SAVEME', active: true, coupon: 'save50-2mo' }] })), create: vi.fn() },
      coupons: { retrieve: vi.fn(), create: vi.fn() },
    } as any;
    expect(await ensureComebackPromoCode(stripe)).toBe('SAVEME');
    expect(await ensureComebackPromoCode(stripe)).toBe('SAVEME');
    expect(stripe.promotionCodes.list).toHaveBeenCalledTimes(1); // cached
    expect(stripe.promotionCodes.create).not.toHaveBeenCalled();
  });

  it('creates COMEBACK50 once when none exists, after making sure the coupon exists', async () => {
    const stripe = {
      invoices: { retrieve: vi.fn() },
      subscriptions: { retrieve: vi.fn(), list: vi.fn() },
      promotionCodes: {
        list: vi.fn(async () => ({ data: [] })),
        create: vi.fn(async (params: any) => ({ code: params.code, active: true, coupon: params.coupon })),
      },
      coupons: {
        retrieve: vi.fn(async () => { throw Object.assign(new Error('missing'), { code: 'resource_missing' }); }),
        create: vi.fn(async () => ({ id: 'save50-2mo' })),
      },
    } as any;
    expect(await ensureComebackPromoCode(stripe)).toBe('COMEBACK50');
    expect(stripe.coupons.create).toHaveBeenCalledWith(expect.objectContaining({ id: 'save50-2mo', percent_off: 50, duration_in_months: 2 }));
    expect(stripe.promotionCodes.create).toHaveBeenCalledWith({ coupon: 'save50-2mo', code: 'COMEBACK50' });
  });

  it('falls back to no offer when Stripe refuses', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const stripe = {
      invoices: { retrieve: vi.fn() },
      subscriptions: { retrieve: vi.fn(), list: vi.fn() },
      promotionCodes: { list: vi.fn(async () => { throw new Error('stripe down'); }), create: vi.fn() },
      coupons: { retrieve: vi.fn(), create: vi.fn() },
    } as any;
    expect(await ensureComebackPromoCode(stripe)).toBeNull();
  });
});

describe('runBillingFollowUps', () => {
  const t0 = Date.UTC(2026, 9, 1);
  const now = new Date(t0 + 10 * 24 * 3600 * 1000);
  const ledgerRows = [
    {
      user_id: 'u1',
      email: 'a@example.com',
      template: 'payment_failed',
      ref: 'in_1',
      payload: { subscription_id: 'sub_1', invoice_id: 'in_1' },
      sent_at: new Date(t0).toISOString(),
      resend_id: 'msg_1',
      error: null,
    },
    {
      user_id: 'u2',
      email: 'b@example.com',
      template: 'checkout_recovery',
      ref: 'cs_1',
      payload: { recovery_url: 'https://r/1', mode: 'subscription', plan: 'monthly', amount_cents: 999, currency: 'usd' },
      sent_at: new Date(t0).toISOString(),
      resend_id: 'msg_2',
      error: null,
    },
  ];

  function stripeWith(status: string, invoiceStatus = 'open') {
    return {
      invoices: { retrieve: vi.fn(async (id: string) => ({ id, status: invoiceStatus, amount_due: 999, amount_remaining: 999, currency: 'usd', hosted_invoice_url: 'https://i/1', next_payment_attempt: null })) },
      subscriptions: { retrieve: vi.fn(async () => ({ id: 'sub_1', status })), list: vi.fn(async () => ({ data: [] })) },
      promotionCodes: { list: vi.fn(async () => ({ data: [{ code: 'COMEBACK50', active: true, coupon: 'save50-2mo' }] })), create: vi.fn() },
      coupons: { retrieve: vi.fn(), create: vi.fn() },
    } as any;
  }

  beforeEach(() => resetComebackPromoCodeForTests());

  it('a dry run counts what is due and sends nothing', async () => {
    const { deps, sent } = fakeDeps();
    const summary = await runBillingFollowUps({ stripe: stripeWith('past_due'), supabase: fakeSupabase({ ledgerRows }), deps, now, dry: true });
    expect(summary).toMatchObject({ available: true, payment_failed_reminder: { due: 1, sent: 0 }, checkout_recovery_offer: { due: 1, sent: 0 } });
    expect(sent).toHaveLength(0);
  });

  it('sends the reminder while still past_due with the invoice open, and the offer with the promo code', async () => {
    const { deps, sent } = fakeDeps();
    const onSent = vi.fn();
    const summary = await runBillingFollowUps({
      stripe: stripeWith('past_due'),
      supabase: fakeSupabase({ ledgerRows, usage: { is_pro: false, subscription_status: 'inactive' } }),
      deps,
      now,
      onSent,
    });
    expect(summary).toMatchObject({
      payment_failed_reminder: { due: 1, sent: 1, skipped: 0 },
      checkout_recovery_offer: { due: 1, sent: 1, skipped: 0, promo_code: 'COMEBACK50' },
      failures: [],
    });
    expect(sent.map((s) => s.subject)).toEqual([
      'Half price for two months of Octree Pro',
      'Reminder: Octree Pro payment still failing',
    ]);
    expect(sent[0].html).toContain('prefilled_promo_code=COMEBACK50');
    expect(onSent).toHaveBeenCalledTimes(2);
  });

  it('skips the reminder once the subscription recovered, and the offer once the user subscribed, closing both in the ledger', async () => {
    const { deps, sent, skipped } = fakeDeps();
    const summary = await runBillingFollowUps({
      stripe: stripeWith('active'),
      supabase: fakeSupabase({ ledgerRows, usage: { is_pro: true, subscription_status: 'active' } }),
      deps,
      now,
    });
    expect(summary).toMatchObject({
      payment_failed_reminder: { due: 1, sent: 0, skipped: 1 },
      checkout_recovery_offer: { due: 1, sent: 0, skipped: 1 },
      failures: [],
    });
    expect(sent).toHaveLength(0);
    // A skip is final: the key is closed so tomorrow's run neither re-reads
    // Stripe for it nor lets it take a slot from a newer follow-up.
    expect(skipped).toEqual([
      // Oldest-eligible first: the offer (48h) is due before the reminder (5d).
      { key: 'u2:checkout_recovery_offer:cs_1', reason: 'subscribed since' },
      { key: 'u1:payment_failed_reminder:in_1', reason: 'subscription is active' },
    ]);
  });

  it('skips the reminder when the invoice is no longer open', async () => {
    const { deps, sent, skipped } = fakeDeps();
    const summary = await runBillingFollowUps({
      stripe: stripeWith('past_due', 'paid'),
      supabase: fakeSupabase({ ledgerRows: [ledgerRows[0]] }),
      deps,
      now,
    });
    expect(summary.payment_failed_reminder).toEqual({ due: 1, sent: 0, skipped: 1 });
    expect(sent).toHaveLength(0);
    expect(skipped).toEqual([{ key: 'u1:payment_failed_reminder:in_1', reason: 'invoice is paid' }]);
  });

  it('a closed skip is never selected again: the follow-up selection sees the row', () => {
    const closed: BillingLedgerRow = {
      userId: 'u1',
      email: 'a@example.com',
      template: 'payment_failed_reminder',
      ref: 'in_1',
      payload: null,
      sentAt: new Date(t0 + 6 * 24 * 3600 * 1000).toISOString(),
      resendId: null,
      error: 'skipped: subscription is active',
    };
    const first: BillingLedgerRow = {
      userId: 'u1',
      email: 'a@example.com',
      template: 'payment_failed',
      ref: 'in_1',
      payload: { subscription_id: 'sub_1' },
      sentAt: new Date(t0).toISOString(),
      resendId: 'msg_1',
      error: null,
    };
    expect(selectBillingFollowUps([first, closed], now)).toEqual([]);
  });

  it('reports the ledger as unavailable before the migration', async () => {
    const { deps } = fakeDeps();
    const summary = await runBillingFollowUps({
      stripe: stripeWith('past_due'),
      supabase: fakeSupabase({ ledgerError: { code: '42703', message: 'column "ref" does not exist' } }),
      deps,
      now,
    });
    expect(summary.available).toBe(false);
  });
});
