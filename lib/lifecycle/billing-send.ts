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
import { readExportUnlocked } from '@/lib/export-unlock';
import {
  CHECKOUT_RECOVERY_COOLDOWN_MS,
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
import { isMissingLedgerSchema, MAX_SEND_ATTEMPTS } from './load';
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
  /** Defaults to now; injected for the cooldown tests. */
  now?: Date;
}

/**
 * Whether a checkout-recovery email (first or offer) was delivered to the
 * user within CHECKOUT_RECOVERY_COOLDOWN_MS. Reads only columns the ledger
 * had before the billing migration, so a pending migration cannot make
 * this throw.
 */
export async function recentlyEmailedCheckoutRecovery(supabase: Db, userId: string, now: Date): Promise<boolean> {
  const since = new Date(now.getTime() - CHECKOUT_RECOVERY_COOLDOWN_MS).toISOString();
  const { data, error } = await supabase
    .from('lifecycle_emails')
    .select('id')
    .eq('user_id', userId)
    .in('template', ['checkout_recovery', 'checkout_recovery_offer'])
    .not('resend_id', 'is', null)
    .gte('sent_at', since)
    .limit(1);
  if (error) throw new Error(error.message);
  return (data ?? []).length > 0;
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
  // An abandoned `export_single` for a project unlocked since (another tab,
  // another session): finishing it would charge $4.99 for nothing.
  const exportProjectId = input.session.metadata?.export_project_id;
  if (exportProjectId && (await readExportUnlocked(input.supabase, exportProjectId))) {
    return { sent: false, template, ref: checkout.sessionId, reason: 'export already unlocked', checkout };
  }
  // Every click on an upgrade button is a new session, and every one of
  // them expires: without this, five looks at the paywall in a week would be
  // five recovery emails (and five offers two days after each). One
  // recovery sequence per user per cooldown; the later sessions get no
  // ledger row, so no offer follows them either.
  if (await recentlyEmailedCheckoutRecovery(input.supabase, checkout.userId, input.now ?? new Date())) {
    return { sent: false, template, ref: checkout.sessionId, reason: 'recovery email sent recently', checkout };
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

export interface PaymentFailedSweepSummary {
  /** Past-due / unpaid subscriptions whose latest invoice is open with an amount due. */
  candidates: number;
  /** Candidates linked to a user with no `payment_failed` row for that invoice yet. */
  due: number;
  sent: number;
  /** Candidates that did not get a notice (unlinked, already noticed, no email, suppressed, failed). */
  skipped: number;
  /** More delinquent subscriptions exist than one run lists (PAYMENT_FAILED_SWEEP_LIST_CAP). */
  truncated: boolean;
  /** Dry run only: the first due subscriptions. */
  first_subscription_ids?: string[];
}

export interface BillingFollowUpSummary {
  /** False when the ledger lacks the billing columns (migration pending). */
  available: boolean;
  payment_failed_sweep: PaymentFailedSweepSummary;
  payment_failed_reminder: { due: number; sent: number; skipped: number };
  checkout_recovery_offer: { due: number; sent: number; skipped: number; promo_code: string | null };
  failures: Array<{ userId: string; template: string; ref: string; reason: string }>;
}

const BILLING_TEMPLATES_IN_LEDGER = ['payment_failed', 'payment_failed_reminder', 'checkout_recovery', 'checkout_recovery_offer'];

export async function loadBillingLedgerRows(supabase: Db): Promise<BillingLedgerRow[] | null> {
  const { data, error } = await supabase
    .from('lifecycle_emails')
    .select('user_id, email, template, ref, payload, sent_at, resend_id, error, attempts')
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
    attempts: row.attempts,
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
  /** Fire-and-forget analytics for a `payment_failed` notice the sweep sent. */
  onPaymentFailedSent?: (userId: string, invoice: FailedInvoiceSummary | null) => void;
  cap?: number;
}

const DEFAULT_FOLLOW_UP_CAP = 50;

/**
 * Sends the reminders that are due (see `selectBillingFollowUps`), after a
 * fresh look at Stripe / user_usage for each one. Every `skip:` outcome is
 * final (the subscription recovered or ended, the invoice settled, the user
 * subscribed), so it is closed in the ledger (`markSkipped`) and never
 * selected again. Without that the oldest skips would be re-read from
 * Stripe every day and, past the cap, starve every newer follow-up: the
 * due list is oldest-first and `cap` long.
 */
export async function runBillingFollowUps(input: BillingFollowUpInput): Promise<BillingFollowUpSummary> {
  const summary: BillingFollowUpSummary = {
    available: true,
    payment_failed_sweep: { candidates: 0, due: 0, sent: 0, skipped: 0, truncated: false },
    payment_failed_reminder: { due: 0, sent: 0, skipped: 0 },
    checkout_recovery_offer: { due: 0, sent: 0, skipped: 0, promo_code: null },
    failures: [],
  };

  const rows = await loadBillingLedgerRows(input.supabase);
  if (rows === null) return { ...summary, available: false };

  const cap = input.cap ?? DEFAULT_FOLLOW_UP_CAP;
  const throttleMs = input.deps.throttleMs ?? 600;

  // The sweep first: a notice it sends today makes a reminder due in 5 days
  // through the same ledger row, exactly as a webhook-sent one does.
  // A Stripe or Supabase error here is reported, not thrown: the reminders
  // and offers below still go out.
  try {
    summary.payment_failed_sweep = await runPaymentFailedSweep(input, rows, summary.failures, cap, throttleMs);
  } catch (error) {
    summary.failures.push({
      userId: '',
      template: 'payment_failed',
      ref: 'sweep',
      reason: error instanceof Error ? error.message : String(error),
    });
  }

  const due = selectBillingFollowUps(rows, input.now);
  for (const item of due) summary[item.template].due += 1;
  if (input.dry || due.length === 0) return summary;

  let sends = summary.payment_failed_sweep.sent;
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
        if (result.reason.startsWith('skip:')) {
          await input.deps.ledger.markSkipped({
            userId: item.userId,
            email: item.email,
            template: item.template,
            ref: item.ref,
            reason: result.reason.slice('skip:'.length).trim(),
            payload: item.payload,
          });
        } else {
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

// --- payment_failed sweep (daily cron) ---------------------------------------------

/** At most this many delinquent subscriptions are listed per run (both statuses together). */
export const PAYMENT_FAILED_SWEEP_LIST_CAP = 100;
const SWEEP_PAGE_SIZE = 100;

export interface DelinquentSubscription {
  subscriptionId: string;
  invoiceId: string;
  latestInvoice: Stripe.Subscription['latest_invoice'];
  /** `subscription.metadata.user_id`, the id the webhook sends to; null when absent. */
  metadataUserId: string | null;
}

/**
 * Whether the subscription's latest invoice is one we should dun for: an
 * expanded invoice that is `open` with something still owed. A string id
 * (not expanded), a draft, paid, void or uncollectible invoice, and a zero
 * amount are all skipped.
 */
function collectableInvoice(invoice: Stripe.Subscription['latest_invoice']): invoice is Stripe.Invoice {
  if (!invoice || typeof invoice === 'string') return false;
  if (invoice.status !== 'open') return false;
  const owed = typeof invoice.amount_remaining === 'number' ? invoice.amount_remaining : invoice.amount_due;
  return typeof owed === 'number' && owed > 0;
}

/**
 * The past_due / unpaid subscriptions whose latest invoice is open with an
 * amount due, one `subscriptions.list` call per status per page with the
 * invoice expanded. `truncated` when the cap was reached and more may exist.
 *
 * A subscription with `pause_collection` set is skipped: billing was paused
 * on purpose (the app shows it as `paused`, not delinquent), so a "payment
 * failed" notice would be wrong. One with `cancel_at_period_end` is kept:
 * its open invoice is still collectable and Stripe still retries it, which
 * is exactly what the notice is about (the webhook sends it too).
 */
export async function listDelinquentSubscriptions(
  stripe: Pick<BillingStripe, 'subscriptions'>,
  limit = PAYMENT_FAILED_SWEEP_LIST_CAP
): Promise<{ subscriptions: DelinquentSubscription[]; listed: number; truncated: boolean }> {
  const subscriptions: DelinquentSubscription[] = [];
  let listed = 0;
  let truncated = false;

  for (const status of ['past_due', 'unpaid'] as const) {
    let startingAfter: string | undefined;
    for (;;) {
      if (listed >= limit) {
        truncated = true;
        break;
      }
      const page = await stripe.subscriptions.list({
        status,
        limit: Math.min(SWEEP_PAGE_SIZE, limit - listed),
        expand: ['data.latest_invoice'],
        ...(startingAfter ? { starting_after: startingAfter } : {}),
      });
      for (const sub of page.data) {
        listed += 1;
        if (sub.pause_collection) continue;
        const invoice = sub.latest_invoice;
        if (!collectableInvoice(invoice)) continue;
        const metadataUserId = typeof sub.metadata?.user_id === 'string' && sub.metadata.user_id ? sub.metadata.user_id : null;
        subscriptions.push({ subscriptionId: sub.id, invoiceId: invoice.id, latestInvoice: invoice, metadataUserId });
      }
      const last = page.data[page.data.length - 1];
      if (!page.has_more || !last) break;
      if (listed >= limit) {
        truncated = true;
        break;
      }
      startingAfter = last.id;
    }
    if (truncated) break;
  }
  return { subscriptions, listed, truncated };
}

/**
 * user_usage.stripe_subscription_id -> user_id for the given subscriptions,
 * in one query. A subscription no row points at is not ours to email.
 */
export async function userIdsForSubscriptions(supabase: Db, subscriptionIds: string[]): Promise<Map<string, string>> {
  const users = new Map<string, string>();
  if (subscriptionIds.length === 0) return users;
  const { data, error } = await supabase
    .from('user_usage')
    .select('user_id, stripe_subscription_id')
    .in('stripe_subscription_id', subscriptionIds);
  if (error) throw new Error(error.message);
  for (const row of data ?? []) {
    if (row.stripe_subscription_id && !users.has(row.stripe_subscription_id)) users.set(row.stripe_subscription_id, row.user_id);
  }
  return users;
}

/**
 * The webhook sends `payment_failed` only on the update that moves a
 * subscription INTO past_due / unpaid. A subscription that was already
 * past_due when that code shipped, or whose transition event was missed,
 * renews with status still past_due and no previous status, so it would
 * never be noticed (and the reminder, which keys off the notice, never
 * becomes due). This sweep closes the gap: every delinquent subscription
 * with an open invoice and no `payment_failed` row for that invoice gets
 * the notice through `sendPaymentFailedEmail`, the webhook's own path.
 *
 * Who gets it: the user whose user_usage row points at the subscription,
 * else `subscription.metadata.user_id` (what the webhook uses; it covers a
 * user whose row has since moved to a newer subscription). If the ledger
 * already has a row for the invoice under some user, that user is used, so
 * the claim hits the same (user, template, invoice) key as the webhook and
 * the unique key decides who sends.
 *
 * A row whose send failed with attempts left is handed to the claim, which
 * retries it (claim_lifecycle_retry, capped at MAX_SEND_ATTEMPTS). The
 * retry moves `sent_at` to the retry time, so the 5-day reminder counts
 * from the notice that actually went out. Any other row means the notice
 * is handled (sent, in flight, out of attempts, or closed as skipped).
 */
async function runPaymentFailedSweep(
  input: BillingFollowUpInput,
  rows: BillingLedgerRow[],
  failures: BillingFollowUpSummary['failures'],
  cap: number,
  throttleMs: number
): Promise<PaymentFailedSweepSummary> {
  const { subscriptions, truncated } = await listDelinquentSubscriptions(input.stripe);
  const summary: PaymentFailedSweepSummary = { candidates: subscriptions.length, due: 0, sent: 0, skipped: 0, truncated };

  const noticeByInvoice = new Map<string, BillingLedgerRow>();
  for (const row of rows) {
    if (row.template !== 'payment_failed' || !row.ref) continue;
    const seen = noticeByInvoice.get(row.ref);
    // Prefer a row that blocks the send over a retryable one.
    if (!seen || (isRetryableNotice(seen) && !isRetryableNotice(row))) noticeByInvoice.set(row.ref, row);
  }
  const users = await userIdsForSubscriptions(
    input.supabase,
    subscriptions.map((sub) => sub.subscriptionId)
  );

  const due: Array<DelinquentSubscription & { userId: string }> = [];
  for (const sub of subscriptions) {
    const notice = noticeByInvoice.get(sub.invoiceId);
    if (notice && !isRetryableNotice(notice)) continue;
    const userId = notice?.userId ?? users.get(sub.subscriptionId) ?? sub.metadataUserId;
    if (!userId) continue;
    due.push({ ...sub, userId });
  }
  summary.due = due.length;

  if (input.dry) {
    summary.skipped = summary.candidates - summary.due;
    summary.first_subscription_ids = due.slice(0, 10).map((sub) => sub.subscriptionId);
    return summary;
  }

  let sends = 0;
  for (const sub of due.slice(0, cap)) {
    if (sends > 0 && throttleMs > 0) await new Promise((resolve) => setTimeout(resolve, throttleMs));
    try {
      const outcome = await sendPaymentFailedEmail({
        stripe: input.stripe,
        supabase: input.supabase,
        deps: input.deps,
        userId: sub.userId,
        subscription: { id: sub.subscriptionId, latest_invoice: sub.latestInvoice },
      });
      if (outcome.sent) {
        sends += 1;
        summary.sent += 1;
        input.onPaymentFailedSent?.(sub.userId, outcome.invoice);
      } else if (outcome.reason !== 'already sent' && outcome.reason !== 'opted out' && outcome.reason !== 'user has no email') {
        failures.push({ userId: sub.userId, template: 'payment_failed', ref: sub.invoiceId, reason: outcome.reason });
      }
    } catch (error) {
      failures.push({
        userId: sub.userId,
        template: 'payment_failed',
        ref: sub.invoiceId,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }
  summary.skipped = summary.candidates - summary.sent;
  return summary;
}

/** A notice row whose send failed and that the retry claim would take over. */
function isRetryableNotice(row: BillingLedgerRow): boolean {
  return row.resendId === null && row.error !== null && (row.attempts ?? 1) < MAX_SEND_ATTEMPTS;
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
