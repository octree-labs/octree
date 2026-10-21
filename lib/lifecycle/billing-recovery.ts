/**
 * Billing recovery: dunning for past-due subscriptions and abandoned-checkout
 * recovery. The pure parts live here so they are unit-testable without
 * Stripe or Supabase; lib/lifecycle/billing-send.ts does the I/O.
 *
 * What goes out, and when:
 *
 *   payment_failed            at once, from the Stripe webhook, when a
 *                             customer.subscription.updated moves the
 *                             subscription into past_due / unpaid. Ledger
 *                             key: the invoice id, so Stripe redeliveries
 *                             and later updates of the same delinquency
 *                             never send twice. Also by the daily cron's
 *                             sweep, for any past_due / unpaid subscription
 *                             with an open invoice that has no notice yet
 *                             (a renewal of an already-past_due
 *                             subscription never carries the transition).
 *   payment_failed_reminder   by the daily lifecycle cron, 5 days after the
 *                             notice, if the subscription is still past_due
 *                             and that invoice is still open. Same key, so
 *                             at most one reminder per invoice.
 *   checkout_recovery         at once, from the webhook, when a Checkout
 *                             Session expires with a recovery URL and the
 *                             user has no live subscription. Key: the
 *                             session id.
 *   checkout_recovery_offer   by the cron, 48h later, if the user still has
 *                             no subscription; carries the save coupon's
 *                             promotion code when one exists. Subscription
 *                             carts only: the coupon is `repeating` and does
 *                             not apply to a one-off payment.
 */
import type Stripe from 'stripe';

import type { BillingRecoveryTemplate } from '@/lib/email/lifecycle';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

export const PAYMENT_FAILED_REMINDER_DELAY_MS = 5 * DAY_MS;
export const CHECKOUT_OFFER_DELAY_MS = 48 * HOUR_MS;
/**
 * At most one checkout-recovery sequence (first email + offer) per user in
 * this window, however many sessions they open and abandon in it.
 */
export const CHECKOUT_RECOVERY_COOLDOWN_MS = 7 * DAY_MS;

/** The promotion code created for the save coupon when none exists yet. */
export const COMEBACK_PROMO_CODE = 'COMEBACK50';

/**
 * A `user_usage` row that means "has a subscription relationship": live,
 * in dunning, paused through the cancel flow, or staff. Mirrors
 * SUBSCRIPTION_STATUSES in lib/lifecycle/select.ts.
 */
const SUBSCRIBED_STATUSES = new Set(['active', 'trialing', 'past_due', 'unpaid', 'paused', 'unlimited']);

/** Stripe statuses that count as "subscribed" for recovery purposes. */
export const LIVE_STRIPE_STATUSES: ReadonlySet<Stripe.Subscription.Status> = new Set([
  'active',
  'trialing',
  'past_due',
  'unpaid',
]);

export const DELINQUENT_STRIPE_STATUSES: ReadonlySet<Stripe.Subscription.Status> = new Set(['past_due', 'unpaid']);

export function usageRowHasSubscription(
  row: { is_pro?: boolean | null; subscription_status?: string | null } | null | undefined
): boolean {
  if (!row) return false;
  return Boolean(row.is_pro) || SUBSCRIBED_STATUSES.has(row.subscription_status ?? '');
}

// --- Dunning -----------------------------------------------------------------

/** The id of a subscription's latest invoice, expanded or not. */
export function latestInvoiceId(subscription: Pick<Stripe.Subscription, 'latest_invoice'>): string | null {
  const invoice = subscription.latest_invoice;
  if (!invoice) return null;
  return typeof invoice === 'string' ? invoice : invoice.id;
}

export interface FailedInvoiceSummary {
  invoiceId: string;
  amountCents: number | null;
  currency: string | null;
  hostedInvoiceUrl: string | null;
  /** Unix seconds of Stripe's next automatic retry; null when none is scheduled. */
  nextPaymentAttempt: number | null;
  status: string | null;
}

export type InvoiceLike = Pick<Stripe.Invoice, 'id'> &
  Partial<Pick<Stripe.Invoice, 'amount_due' | 'amount_remaining' | 'currency' | 'hosted_invoice_url' | 'next_payment_attempt' | 'status'>>;

export function describeFailedInvoice(invoice: InvoiceLike): FailedInvoiceSummary {
  const amount = typeof invoice.amount_remaining === 'number' ? invoice.amount_remaining : invoice.amount_due;
  return {
    invoiceId: invoice.id,
    amountCents: typeof amount === 'number' ? amount : null,
    currency: invoice.currency ?? null,
    hostedInvoiceUrl: invoice.hosted_invoice_url ?? null,
    nextPaymentAttempt: typeof invoice.next_payment_attempt === 'number' ? invoice.next_payment_attempt : null,
    status: invoice.status ?? null,
  };
}

/** What the `payment_failed` ledger row stores for the reminder. */
export interface PaymentFailedPayload extends Record<string, unknown> {
  subscription_id: string;
  invoice_id: string;
  amount_cents: number | null;
  currency: string | null;
  hosted_invoice_url: string | null;
  next_payment_attempt: number | null;
}

// --- Abandoned checkout --------------------------------------------------------

export interface AbandonedCheckout {
  sessionId: string;
  userId: string;
  /** `metadata.plan` as the checkout route wrote it (monthly, annual, credits_100, ...). */
  plan: string | null;
  mode: Stripe.Checkout.Session.Mode;
  amountCents: number | null;
  currency: string | null;
  customerId: string | null;
  /** Stripe's recovery URL, when the session was created with recovery enabled. */
  recoveryUrl: string | null;
  /** Unix seconds; the recovery URL stops working after this. */
  recoveryExpiresAt: number | null;
}

export type ExpiredSessionLike = Pick<Stripe.Checkout.Session, 'id' | 'mode'> &
  Partial<Pick<Stripe.Checkout.Session, 'metadata' | 'amount_total' | 'currency' | 'customer' | 'after_expiration'>>;

/** Null when the session carries no `metadata.user_id` (not one of ours). */
export function describeAbandonedCheckout(session: ExpiredSessionLike): AbandonedCheckout | null {
  const userId = session.metadata?.user_id;
  if (!userId) return null;
  const recovery = session.after_expiration?.recovery ?? null;
  const customer = session.customer;
  return {
    sessionId: session.id,
    userId,
    plan: session.metadata?.plan ?? null,
    mode: session.mode,
    amountCents: typeof session.amount_total === 'number' ? session.amount_total : null,
    currency: session.currency ?? null,
    customerId: typeof customer === 'string' ? customer : customer?.id ?? null,
    recoveryUrl: recovery?.url ?? null,
    recoveryExpiresAt: typeof recovery?.expires_at === 'number' ? recovery.expires_at : null,
  };
}

/** What the `checkout_recovery` ledger row stores for the offer email. */
export interface CheckoutRecoveryPayload extends Record<string, unknown> {
  session_id: string;
  plan: string | null;
  mode: string;
  amount_cents: number | null;
  currency: string | null;
  customer_id: string | null;
  recovery_url: string;
  recovery_expires_at: number | null;
}

/**
 * The recovery URL with Stripe's `prefilled_promo_code` parameter. The code
 * is also spelled out in the email, so the offer stands even where the
 * hosted page ignores the parameter.
 */
export function withPromoCode(url: string, code: string | null): string {
  if (!code) return url;
  try {
    const parsed = new URL(url);
    parsed.searchParams.set('prefilled_promo_code', code);
    return parsed.toString();
  } catch {
    return `${url}${url.includes('?') ? '&' : '?'}prefilled_promo_code=${encodeURIComponent(code)}`;
  }
}

// --- Follow-up selection ------------------------------------------------------

export interface BillingLedgerRow {
  userId: string;
  email: string;
  template: string;
  ref: string;
  payload: Record<string, unknown> | null;
  /** ISO timestamp of the claim (the send, for a successful row). */
  sentAt: string;
  resendId: string | null;
  error: string | null;
}

export interface BillingFollowUp {
  template: Extract<BillingRecoveryTemplate, 'payment_failed_reminder' | 'checkout_recovery_offer'>;
  userId: string;
  email: string;
  ref: string;
  payload: Record<string, unknown>;
  /** When the follow-up became due; sent oldest first. */
  eligibleSince: number;
}

const FOLLOW_UP_OF: Record<'payment_failed' | 'checkout_recovery', BillingFollowUp['template']> = {
  payment_failed: 'payment_failed_reminder',
  checkout_recovery: 'checkout_recovery_offer',
};

const DELAY_OF: Record<BillingFollowUp['template'], number> = {
  payment_failed_reminder: PAYMENT_FAILED_REMINDER_DELAY_MS,
  checkout_recovery_offer: CHECKOUT_OFFER_DELAY_MS,
};

/**
 * The follow-ups due now: a delivered first email (`resend_id` set) older
 * than its delay, with no follow-up row of any state for the same
 * (user, ref). The caller still checks Stripe / user_usage at send time: a
 * reminder only goes to a subscription that is still past_due, an offer
 * only to someone still without a subscription.
 */
export function selectBillingFollowUps(rows: BillingLedgerRow[], now: Date): BillingFollowUp[] {
  const nowMs = now.getTime();
  const existing = new Set(rows.map((row) => `${row.userId}:${row.template}:${row.ref}`));
  const due: BillingFollowUp[] = [];

  for (const row of rows) {
    if (row.template !== 'payment_failed' && row.template !== 'checkout_recovery') continue;
    if (!row.resendId || !row.ref || !row.payload) continue;
    const template = FOLLOW_UP_OF[row.template];
    if (existing.has(`${row.userId}:${template}:${row.ref}`)) continue;

    const sentAt = Date.parse(row.sentAt);
    if (Number.isNaN(sentAt)) continue;
    const eligibleSince = sentAt + DELAY_OF[template];
    if (eligibleSince > nowMs) continue;

    if (template === 'checkout_recovery_offer') {
      // The save coupon repeats monthly, so only a subscription cart can
      // carry it; and a recovery URL past its expiry would 404.
      if (row.payload.mode !== 'subscription') continue;
      const expires = row.payload.recovery_expires_at;
      if (typeof expires === 'number' && expires * 1000 <= nowMs) continue;
    }

    due.push({ template, userId: row.userId, email: row.email, ref: row.ref, payload: row.payload, eligibleSince });
  }

  due.sort((a, b) => a.eligibleSince - b.eligibleSince || a.userId.localeCompare(b.userId));
  return due;
}
