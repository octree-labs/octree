/**
 * The I/O side of billing recovery (see lib/lifecycle/billing-recovery.ts
 * for the rules): the immediate sends the Stripe webhook makes, and the
 * follow-ups the daily lifecycle cron makes. Both go through
 * `sendLifecycleEmail`, so the ledger (`lifecycle_emails`, unique on
 * user + template + ref) is the only dedupe and a send from either side
 * blocks the other.
 *
 * Nothing here throws for a missing ledger: when the migration is pending
 * the result says `ledger_unavailable` and the caller logs it. The webhook
 * must answer Stripe 200 whatever happens to the email.
 */
import type Stripe from 'stripe';
import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '@/database.types';
import {
  checkoutRecoveryEmail,
  checkoutRecoveryOfferEmail,
  paymentFailedEmail,
  paymentFailedReminderEmail,
  type BillingRecoveryTemplate,
} from '@/lib/email/lifecycle';
import { SAVE_COUPON_ID, SAVE_COUPON_MONTHS, SAVE_COUPON_PERCENT_OFF } from '@/lib/stripe-subscription';
import {
  COMEBACK_PROMO_CODE,
  DELINQUENT_STRIPE_STATUSES,
  LIVE_STRIPE_STATUSES,
  describeAbandonedCheckout,
  describeFailedInvoice,
  latestInvoiceId,
  selectBillingFollowUps,
  usageRowHasSubscription,
  withPromoCode,
  type AbandonedCheckout,
  type BillingFollowUp,
  type BillingLedgerRow,
  type CheckoutRecoveryPayload,
  type FailedInvoiceSummary,
  type PaymentFailedPayload,
} from './billing-recovery';
import { isMissingLedgerSchema } from './load';
import type { LifecycleCandidate } from './select';
import { LifecycleLedgerUnavailableError, sendLifecycleEmail, type LifecycleSendDeps, type LifecycleSendResult } from './send';

type Db = SupabaseClient<Database>;

/** The slice of the Stripe client billing recovery needs; mocked in tests. */
export type BillingStripe = {
  invoices: Pick<Stripe.InvoicesResource, 'retrieve'>;
  subscriptions: Pick<Stripe.SubscriptionsResource, 'retrieve' | 'list'>;
  promotionCodes?: Pick<Stripe.PromotionCodesResource, 'list' | 'create'>;
  coupons?: Pick<Stripe.CouponsResource, 'retrieve' | 'create'>;
};

export type BillingSendOutcome =
  | { sent: true; template: BillingRecoveryTemplate; ref: string; resendId: string | null }
  | { sent: false; template: BillingRecoveryTemplate; ref: string | null; reason: string };

function billingUrlFor(deps: LifecycleSendDeps): string {
  return `${deps.appUrl}/settings`;
}

/** The account's email address (auth.users), lower-cased; null when it has none. */
export async function lookupUserEmail(supabase: Db, userId: string): Promise<string | null> {
  const { data, error } = await supabase.auth.admin.getUserById(userId);
  if (error || !data.user?.email) return null;
  return data.user.email.toLowerCase();
}

async function usageRow(supabase: Db, userId: string) {
  const { data, error } = await supabase
    .from('user_usage')
    .select('is_pro, subscription_status, stripe_customer_id')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

/**
 * Whether the user has a subscription now: the user_usage row the webhook
 * keeps current, and, when a Stripe customer is known, Stripe itself (a
 * checkout that completed on another customer record would already have
 * reached user_usage, so this is belt and braces for the same price as one
 * list call).
 */
export async function userHasLiveSubscription(
  supabase: Db,
  stripe: Pick<BillingStripe, 'subscriptions'>,
  userId: string,
  customerId: string | null
): Promise<boolean> {
  const row = await usageRow(supabase, userId);
  if (usageRowHasSubscription(row)) return true;
  const customer = customerId ?? row?.stripe_customer_id ?? null;
  if (!customer) return false;
  const subs = await stripe.subscriptions.list({ customer, status: 'all', limit: 10 });
  return subs.data.some((sub) => LIVE_STRIPE_STATUSES.has(sub.status));
}

function outcomeFrom(result: LifecycleSendResult, template: BillingRecoveryTemplate, ref: string): BillingSendOutcome {
  return result.sent
    ? { sent: true, template, ref, resendId: result.resendId }
    : { sent: false, template, ref, reason: result.reason };
}

async function sendBilling(
  candidate: LifecycleCandidate & { template: BillingRecoveryTemplate; ref: string },
  deps: LifecycleSendDeps
): Promise<BillingSendOutcome> {
  try {
    return outcomeFrom(await sendLifecycleEmail(candidate, deps), candidate.template, candidate.ref);
  } catch (error) {
    if (error instanceof LifecycleLedgerUnavailableError) {
      return { sent: false, template: candidate.template, ref: candidate.ref, reason: `ledger_unavailable: ${error.message}` };
    }
    throw error;
  }
}

// --- Dunning -----------------------------------------------------------------

export interface PaymentFailedSendInput {
  stripe: Pick<BillingStripe, 'invoices'>;
  supabase: Db;
  deps: LifecycleSendDeps;
  userId: string;
  subscription: Pick<Stripe.Subscription, 'id' | 'latest_invoice'>;
}

/**
 * The `payment_failed` notice for the subscription's latest invoice. Called
 * from the webhook on the transition into past_due; the ledger key
 * (user, 'payment_failed', invoice id) makes every later call for the same
 * invoice a no-op.
 */
export async function sendPaymentFailedEmail(
  input: PaymentFailedSendInput
): Promise<BillingSendOutcome & { invoice: FailedInvoiceSummary | null }> {
  const template = 'payment_failed';
  const invoiceId = latestInvoiceId(input.subscription);
  if (!invoiceId) return { sent: false, template, ref: null, reason: 'no latest invoice', invoice: null };

  const email = await lookupUserEmail(input.supabase, input.userId);
  if (!email) return { sent: false, template, ref: invoiceId, reason: 'user has no email', invoice: null };

  const invoice = describeFailedInvoice(await input.stripe.invoices.retrieve(invoiceId));
  const payload: PaymentFailedPayload = {
    subscription_id: input.subscription.id,
    invoice_id: invoice.invoiceId,
    amount_cents: invoice.amountCents,
    currency: invoice.currency,
    hosted_invoice_url: invoice.hostedInvoiceUrl,
    next_payment_attempt: invoice.nextPaymentAttempt,
  };

  const outcome = await sendBilling(
    {
      userId: input.userId,
      email,
      template,
      ref: invoiceId,
      eligibleSince: Date.now(),
      payload,
      transactional: true,
      render: () =>
        paymentFailedEmail({
          amountCents: invoice.amountCents,
          currency: invoice.currency,
          hostedInvoiceUrl: invoice.hostedInvoiceUrl,
          nextPaymentAttempt: invoice.nextPaymentAttempt,
          billingUrl: billingUrlFor(input.deps),
        }),
    },
    input.deps
  );
  return { ...outcome, invoice };
}

// --- Abandoned checkout --------------------------------------------------------

export interface CheckoutRecoverySendInput {
  stripe: Pick<BillingStripe, 'subscriptions'>;
  supabase: Db;
  deps: LifecycleSendDeps;
  session: Parameters<typeof describeAbandonedCheckout>[0];
}

/**
 * The `checkout_recovery` email for an expired session that Stripe gave a
 * recovery URL, unless the user has subscribed in the meantime. Ledger key:
 * (user, 'checkout_recovery', session id).
 */
export async function sendCheckoutRecoveryEmail(
  input: CheckoutRecoverySendInput
): Promise<BillingSendOutcome & { checkout: AbandonedCheckout | null }> {
  const template = 'checkout_recovery';
  const checkout = describeAbandonedCheckout(input.session);
  if (!checkout) return { sent: false, template, ref: null, reason: 'no user_id in session metadata', checkout: null };
  if (!checkout.recoveryUrl) return { sent: false, template, ref: checkout.sessionId, reason: 'no recovery url', checkout };

  if (await userHasLiveSubscription(input.supabase, input.stripe, checkout.userId, checkout.customerId)) {
    return { sent: false, template, ref: checkout.sessionId, reason: 'already subscribed', checkout };
  }

  const email = await lookupUserEmail(input.supabase, checkout.userId);
  if (!email) return { sent: false, template, ref: checkout.sessionId, reason: 'user has no email', checkout };

  const payload: CheckoutRecoveryPayload = {
    session_id: checkout.sessionId,
    plan: checkout.plan,
    mode: checkout.mode,
    amount_cents: checkout.amountCents,
    currency: checkout.currency,
    customer_id: checkout.customerId,
    recovery_url: checkout.recoveryUrl,
    recovery_expires_at: checkout.recoveryExpiresAt,
  };
  const recoveryUrl = checkout.recoveryUrl;

  const outcome = await sendBilling(
    {
      userId: checkout.userId,
      email,
      template,
      ref: checkout.sessionId,
      eligibleSince: Date.now(),
      payload,
      render: ({ unsubscribeUrl }) =>
        checkoutRecoveryEmail({
          recoveryUrl,
          plan: checkout.plan,
          amountCents: checkout.amountCents,
          currency: checkout.currency,
          promoCode: null,
          unsubscribeUrl,
        }),
    },
    input.deps
  );
  return { ...outcome, checkout };
}

// --- The save coupon's promotion code ------------------------------------------

let comebackCode: Promise<string | null> | null = null;

/** Test hook: forget the cached promotion code. */
export function resetComebackPromoCodeForTests(): void {
  comebackCode = null;
}

function stripeErrorCode(error: unknown): string | undefined {
  return (error as { code?: string } | null)?.code;
}

async function ensureSaveCouponWith(stripe: NonNullable<BillingStripe['coupons']>): Promise<void> {
  try {
    await stripe.retrieve(SAVE_COUPON_ID);
    return;
  } catch (error) {
    if (stripeErrorCode(error) !== 'resource_missing') throw error;
  }
  try {
    await stripe.create({
      id: SAVE_COUPON_ID,
      name: `${SAVE_COUPON_PERCENT_OFF}% off for ${SAVE_COUPON_MONTHS} months`,
      percent_off: SAVE_COUPON_PERCENT_OFF,
      duration: 'repeating',
      duration_in_months: SAVE_COUPON_MONTHS,
    });
  } catch (error) {
    if (stripeErrorCode(error) !== 'resource_already_exists') throw error;
  }
}

async function resolveComebackPromoCode(stripe: BillingStripe): Promise<string | null> {
  if (!stripe.promotionCodes || !stripe.coupons) return null;
  const existing = await stripe.promotionCodes.list({ coupon: SAVE_COUPON_ID, active: true, limit: 1 });
  if (existing.data[0]) return existing.data[0].code;

  await ensureSaveCouponWith(stripe.coupons);
  try {
    const created = await stripe.promotionCodes.create({ coupon: SAVE_COUPON_ID, code: COMEBACK_PROMO_CODE });
    return created.code;
  } catch (error) {
    // The code already exists (on this coupon but inactive, or on another
    // coupon): use it only if it is live on the save coupon.
    const byCode = await stripe.promotionCodes.list({ code: COMEBACK_PROMO_CODE, limit: 1 });
    const found = byCode.data[0];
    const couponId = found ? (typeof found.coupon === 'string' ? found.coupon : found.coupon.id) : null;
    if (found?.active && couponId === SAVE_COUPON_ID) return found.code;
    console.error('[billing-recovery] could not create the comeback promotion code:', error);
    return null;
  }
}

/**
 * The promotion code of the save coupon (`save50-2mo`): an existing active
 * one, else `COMEBACK50` created once. Cached per process; null (no offer)
 * when Stripe refuses, so the offer email still goes out without a code.
 */
export function ensureComebackPromoCode(stripe: BillingStripe): Promise<string | null> {
  if (!comebackCode) {
    comebackCode = resolveComebackPromoCode(stripe).catch((error) => {
      console.error('[billing-recovery] promotion code lookup failed:', error);
      comebackCode = null;
      return null;
    });
  }
  return comebackCode;
}

// --- Follow-ups (daily cron) ------------------------------------------------------

export interface BillingFollowUpSummary {
  /** False when the ledger lacks the billing columns (migration pending). */
  available: boolean;
  payment_failed_reminder: { due: number; sent: number; skipped: number };
  checkout_recovery_offer: { due: number; sent: number; skipped: number; promo_code: string | null };
  failures: Array<{ userId: string; template: string; ref: string; reason: string }>;
}

const BILLING_TEMPLATES_IN_LEDGER = ['payment_failed', 'payment_failed_reminder', 'checkout_recovery', 'checkout_recovery_offer'];

export async function loadBillingLedgerRows(supabase: Db): Promise<BillingLedgerRow[] | null> {
  const { data, error } = await supabase
    .from('lifecycle_emails')
    .select('user_id, email, template, ref, payload, sent_at, resend_id, error')
    .in('template', BILLING_TEMPLATES_IN_LEDGER)
    .order('sent_at')
    .limit(5000);
  if (error) {
    if (isMissingLedgerSchema(error)) return null;
    throw new Error(error.message);
  }
  return (data ?? []).map((row) => ({
    userId: row.user_id,
    email: row.email,
    template: row.template,
    ref: row.ref ?? '',
    payload: row.payload && typeof row.payload === 'object' && !Array.isArray(row.payload)
      ? (row.payload as Record<string, unknown>)
      : null,
    sentAt: row.sent_at,
    resendId: row.resend_id,
    error: row.error,
  }));
}

export interface BillingFollowUpInput {
  stripe: BillingStripe;
  supabase: Db;
  deps: LifecycleSendDeps;
  now: Date;
  /** Count what is due without sending (the cron's `?dry=1`). */
  dry?: boolean;
  /** Fire-and-forget analytics for the specific billing events. */
  onSent?: (followUp: BillingFollowUp, extra: { promoCode: string | null; invoice: FailedInvoiceSummary | null }) => void;
  cap?: number;
}

const DEFAULT_FOLLOW_UP_CAP = 50;

/**
 * Sends the reminders that are due (see `selectBillingFollowUps`), after a
 * fresh look at Stripe / user_usage for each one. A skipped follow-up gets
 * no ledger row and is looked at again on the next run until its first
 * email's subject is settled (the subscription recovered or ended, the user
 * subscribed, the recovery URL expired).
 */
export async function runBillingFollowUps(input: BillingFollowUpInput): Promise<BillingFollowUpSummary> {
  const summary: BillingFollowUpSummary = {
    available: true,
    payment_failed_reminder: { due: 0, sent: 0, skipped: 0 },
    checkout_recovery_offer: { due: 0, sent: 0, skipped: 0, promo_code: null },
    failures: [],
  };

  const rows = await loadBillingLedgerRows(input.supabase);
  if (rows === null) return { ...summary, available: false };

  const due = selectBillingFollowUps(rows, input.now);
  for (const item of due) summary[item.template].due += 1;
  if (input.dry || due.length === 0) return summary;

  const cap = input.cap ?? DEFAULT_FOLLOW_UP_CAP;
  const throttleMs = input.deps.throttleMs ?? 600;
  let sends = 0;
  for (const item of due.slice(0, cap)) {
    if (sends > 0 && throttleMs > 0) await new Promise((resolve) => setTimeout(resolve, throttleMs));
    try {
      const result =
        item.template === 'payment_failed_reminder'
          ? await sendPaymentFailedReminder(item, input)
          : await sendCheckoutRecoveryOffer(item, input, summary);
      if (result.sent) {
        sends += 1;
        summary[item.template].sent += 1;
      } else {
        summary[item.template].skipped += 1;
        if (!result.reason.startsWith('skip:')) {
          summary.failures.push({ userId: item.userId, template: item.template, ref: item.ref, reason: result.reason });
        }
      }
    } catch (error) {
      summary[item.template].skipped += 1;
      summary.failures.push({
        userId: item.userId,
        template: item.template,
        ref: item.ref,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return summary;
}

async function sendPaymentFailedReminder(item: BillingFollowUp, input: BillingFollowUpInput): Promise<BillingSendOutcome> {
  const template = 'payment_failed_reminder';
  const subscriptionId = typeof item.payload.subscription_id === 'string' ? item.payload.subscription_id : null;
  if (!subscriptionId) return { sent: false, template, ref: item.ref, reason: 'skip: no subscription id' };

  const subscription = await input.stripe.subscriptions.retrieve(subscriptionId);
  if (!DELINQUENT_STRIPE_STATUSES.has(subscription.status)) {
    return { sent: false, template, ref: item.ref, reason: `skip: subscription is ${subscription.status}` };
  }
  const invoice = describeFailedInvoice(await input.stripe.invoices.retrieve(item.ref));
  if (invoice.status !== 'open') {
    return { sent: false, template, ref: item.ref, reason: `skip: invoice is ${invoice.status ?? 'unknown'}` };
  }

  const outcome = await sendBilling(
    {
      userId: item.userId,
      email: item.email,
      template,
      ref: item.ref,
      eligibleSince: item.eligibleSince,
      payload: { ...item.payload, next_payment_attempt: invoice.nextPaymentAttempt },
      transactional: true,
      render: () =>
        paymentFailedReminderEmail({
          amountCents: invoice.amountCents,
          currency: invoice.currency,
          hostedInvoiceUrl: invoice.hostedInvoiceUrl,
          nextPaymentAttempt: invoice.nextPaymentAttempt,
          billingUrl: billingUrlFor(input.deps),
        }),
    },
    input.deps
  );
  if (outcome.sent) input.onSent?.(item, { promoCode: null, invoice });
  return outcome;
}

async function sendCheckoutRecoveryOffer(
  item: BillingFollowUp,
  input: BillingFollowUpInput,
  summary: BillingFollowUpSummary
): Promise<BillingSendOutcome> {
  const template = 'checkout_recovery_offer';
  const recoveryUrl = typeof item.payload.recovery_url === 'string' ? item.payload.recovery_url : null;
  if (!recoveryUrl) return { sent: false, template, ref: item.ref, reason: 'skip: no recovery url' };

  const customerId = typeof item.payload.customer_id === 'string' ? item.payload.customer_id : null;
  if (await userHasLiveSubscription(input.supabase, input.stripe, item.userId, customerId)) {
    return { sent: false, template, ref: item.ref, reason: 'skip: subscribed since' };
  }

  const promoCode = await ensureComebackPromoCode(input.stripe);
  summary.checkout_recovery_offer.promo_code = promoCode;
  const plan = typeof item.payload.plan === 'string' ? item.payload.plan : null;
  const amountCents = typeof item.payload.amount_cents === 'number' ? item.payload.amount_cents : null;
  const currency = typeof item.payload.currency === 'string' ? item.payload.currency : null;

  const outcome = await sendBilling(
    {
      userId: item.userId,
      email: item.email,
      template,
      ref: item.ref,
      eligibleSince: item.eligibleSince,
      payload: { ...item.payload, promo_code: promoCode },
      render: ({ unsubscribeUrl }) =>
        checkoutRecoveryOfferEmail({
          recoveryUrl: withPromoCode(recoveryUrl, promoCode),
          plan,
          amountCents,
          currency,
          promoCode,
          unsubscribeUrl,
        }),
    },
    input.deps
  );
  if (outcome.sent) input.onSent?.(item, { promoCode, invoice: null });
  return outcome;
}
