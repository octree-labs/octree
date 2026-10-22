/**
 * Daily revenue + funnel digest.
 *
 * Every function here is pure over injected clients (a Stripe SDK instance and
 * a Supabase service-role client) so the calculations can be unit-tested with
 * plain objects. The route in `app/api/cron/daily-digest` wires the real
 * clients, renders the email and sends it.
 */
import type Stripe from 'stripe';
import type { SupabaseClient } from '@supabase/supabase-js';
import { FREE_DAILY_EDIT_LIMIT } from '@/data/constants';
import { OCTREE_STRIPE_APP } from '@/lib/checkout-plans';
import { isOctreeCheckoutSession, isOctreeSubscription } from '@/lib/stripe-webhook';

// ---------------------------------------------------------------------------
// Windows
// ---------------------------------------------------------------------------

export type WindowKey = 'yesterday' | 'd7' | 'd30';

export interface Window {
  key: WindowKey;
  label: string;
  /** Inclusive start (ms). */
  start: number;
  /** Exclusive end (ms). */
  end: number;
}

export type Windows = Record<WindowKey, Window>;

const DAY_MS = 24 * 60 * 60 * 1000;

export function startOfUtcDay(date: Date): number {
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

/**
 * All windows end at the start of "today" (UTC) so that yesterday is a full
 * calendar day and the trailing windows are whole days too.
 */
export function makeWindows(now: Date): Windows {
  const end = startOfUtcDay(now);
  return {
    yesterday: { key: 'yesterday', label: 'Yesterday', start: end - DAY_MS, end },
    d7: { key: 'd7', label: 'Last 7 days', start: end - 7 * DAY_MS, end },
    d30: { key: 'd30', label: 'Last 30 days', start: end - 30 * DAY_MS, end },
  };
}

export const WINDOW_KEYS: WindowKey[] = ['yesterday', 'd7', 'd30'];

/** Stripe timestamps are unix seconds; windows are ms. */
export function stripeTsInWindow(
  ts: number | null | undefined,
  window: Window
): boolean {
  if (ts == null) return false;
  const ms = ts * 1000;
  return ms >= window.start && ms < window.end;
}

export function isoInWindow(iso: string | null | undefined, window: Window): boolean {
  if (!iso) return false;
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return false;
  return ms >= window.start && ms < window.end;
}

export function perWindow<T>(fn: (w: Window) => T, windows: Windows): Record<WindowKey, T> {
  return {
    yesterday: fn(windows.yesterday),
    d7: fn(windows.d7),
    d30: fn(windows.d30),
  };
}

// ---------------------------------------------------------------------------
// Money helpers
// ---------------------------------------------------------------------------

/** Amounts in whole currency units keyed by lower-case ISO code. */
export type ByCurrency = Record<string, number>;

export function addMoney(target: ByCurrency, currency: string, amountCents: number): void {
  const key = currency.toLowerCase();
  target[key] = round2((target[key] ?? 0) + amountCents / 100);
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// ---------------------------------------------------------------------------
// Structural Stripe types (Stripe.* objects satisfy these; tests use literals)
// ---------------------------------------------------------------------------

export interface SubscriptionItemLike {
  quantity?: number;
  price: {
    unit_amount: number | null;
    currency: string;
    recurring: { interval: 'day' | 'week' | 'month' | 'year'; interval_count: number } | null;
  };
}

export interface SubscriptionLike {
  id: string;
  status: string;
  currency: string;
  created: number;
  canceled_at: number | null;
  cancellation_details?: { reason: string | null } | null;
  /** Set while payment collection is paused (cancel-flow save offer); still `active` to Stripe. */
  pause_collection?: { behavior: string; resumes_at: number | null } | null;
  items: { data: SubscriptionItemLike[] };
  /** Decides whether the subscription is Octree's (see `isOctreeSubscription`). */
  metadata?: Record<string, string> | null;
  customer?: CustomerRef;
}

/** A Stripe customer reference: an id, an expanded (possibly deleted) customer, or none. */
export type CustomerRef = string | { id: string } | null | undefined;

export interface InvoiceLike {
  id: string;
  status: string | null;
  currency: string;
  amount_paid: number;
  created: number;
  status_transitions?: { paid_at: number | null } | null;
  customer?: CustomerRef;
  subscription?: string | { id: string } | null;
}

export interface ChargeLike {
  customer?: CustomerRef;
  metadata?: Record<string, string> | null;
}

export interface RefundLike {
  id: string;
  amount: number;
  currency: string;
  created: number;
  /** Expanded (`expand: ['data.charge']`) to tell whose refund it is; an id alone cannot. */
  charge?: string | ChargeLike | null;
}

export interface CheckoutSessionLike {
  id: string;
  status: string | null;
  created: number;
  mode?: Stripe.Checkout.Session.Mode | null;
  metadata?: Record<string, string> | null;
  customer?: CustomerRef;
}

export interface PaymentFailureLike {
  invoiceId: string;
  created: number;
}

// ---------------------------------------------------------------------------
// MRR
// ---------------------------------------------------------------------------

type Interval = NonNullable<SubscriptionItemLike['price']['recurring']>['interval'];

/** How many months one billing interval covers. */
const MONTHS_PER_INTERVAL: Record<Interval, number> = {
  day: 12 / 365.25,
  week: 12 / 52.1775,
  month: 1,
  year: 12,
};

/** Monthly-normalised amount of a subscription item, in cents. */
export function monthlyAmountCents(item: SubscriptionItemLike): number {
  const { price } = item;
  if (!price.recurring || price.unit_amount == null) return 0;
  const quantity = item.quantity ?? 1;
  const months = MONTHS_PER_INTERVAL[price.recurring.interval] * (price.recurring.interval_count || 1);
  if (!months) return 0;
  return (price.unit_amount * quantity) / months;
}

export interface MrrSummary {
  /** USD MRR (whole dollars, 2dp). Only subscriptions billed in USD. */
  usd: number;
  /** CAD MRR, reported separately rather than converted. */
  cad: number;
  /** Every currency, including the two above. */
  byCurrency: ByCurrency;
  activeCount: number;
  trialingCount: number;
}

export const MRR_STATUSES = new Set(['active', 'trialing']);

export function computeMrr(subscriptions: SubscriptionLike[]): MrrSummary {
  const byCurrency: ByCurrency = {};
  let activeCount = 0;
  let trialingCount = 0;

  for (const sub of subscriptions) {
    if (!MRR_STATUSES.has(sub.status)) continue;
    // Paused collection: Stripe keeps the status `active` but voids every
    // invoice until `resumes_at`, so nothing recurs. Not MRR, not churn.
    if (sub.pause_collection) continue;
    if (sub.status === 'active') activeCount += 1;
    else trialingCount += 1;

    for (const item of sub.items.data) {
      const cents = monthlyAmountCents(item);
      if (cents) addMoney(byCurrency, item.price.currency || sub.currency, cents);
    }
  }

  return {
    usd: byCurrency.usd ?? 0,
    cad: byCurrency.cad ?? 0,
    byCurrency,
    activeCount,
    trialingCount,
  };
}

// ---------------------------------------------------------------------------
// Subscriptions: new / cancelled / past due
// ---------------------------------------------------------------------------

export interface CancellationSummary {
  count: number;
  reasons: Record<string, number>;
}

export interface SubscriptionActivity {
  newSubscriptions: Record<WindowKey, number>;
  cancellations: Record<WindowKey, CancellationSummary>;
  pastDueCount: number;
  unpaidCount: number;
}

/** Statuses that represent a subscription that never got going. */
const NEVER_STARTED = new Set(['incomplete', 'incomplete_expired']);

export function summarizeSubscriptions(
  subscriptions: SubscriptionLike[],
  windows: Windows
): SubscriptionActivity {
  const newSubscriptions = perWindow(
    (w) => subscriptions.filter((s) => !NEVER_STARTED.has(s.status) && stripeTsInWindow(s.created, w)).length,
    windows
  );

  const cancellations = perWindow((w) => {
    const summary: CancellationSummary = { count: 0, reasons: {} };
    for (const sub of subscriptions) {
      if (!stripeTsInWindow(sub.canceled_at, w)) continue;
      summary.count += 1;
      const reason = sub.cancellation_details?.reason ?? 'unknown';
      summary.reasons[reason] = (summary.reasons[reason] ?? 0) + 1;
    }
    return summary;
  }, windows);

  return {
    newSubscriptions,
    cancellations,
    pastDueCount: subscriptions.filter((s) => s.status === 'past_due').length,
    unpaidCount: subscriptions.filter((s) => s.status === 'unpaid').length,
  };
}

// ---------------------------------------------------------------------------
// Invoices, failures, refunds, checkouts
// ---------------------------------------------------------------------------

export interface InvoiceActivity {
  /** Gross from invoices paid in the window, by currency. */
  gross: Record<WindowKey, ByCurrency>;
  paidInvoices: Record<WindowKey, number>;
  /** `invoice.payment_failed` events in the window. */
  failedAttempts: Record<WindowKey, number>;
  /** Failed invoices (by event time) whose invoice is now paid. */
  recovered: Record<WindowKey, number>;
}

export function summarizeInvoices(
  invoices: InvoiceLike[],
  failures: PaymentFailureLike[],
  windows: Windows
): InvoiceActivity {
  const byId = new Map(invoices.map((i) => [i.id, i]));

  const gross = perWindow((w) => {
    const total: ByCurrency = {};
    for (const inv of invoices) {
      if (inv.status !== 'paid') continue;
      if (!stripeTsInWindow(inv.status_transitions?.paid_at ?? inv.created, w)) continue;
      addMoney(total, inv.currency, inv.amount_paid);
    }
    return total;
  }, windows);

  const paidInvoices = perWindow(
    (w) =>
      invoices.filter(
        (inv) => inv.status === 'paid' && stripeTsInWindow(inv.status_transitions?.paid_at ?? inv.created, w)
      ).length,
    windows
  );

  const failedAttempts = perWindow((w) => failures.filter((f) => stripeTsInWindow(f.created, w)).length, windows);

  const recovered = perWindow((w) => {
    const seen = new Set<string>();
    for (const f of failures) {
      if (!stripeTsInWindow(f.created, w)) continue;
      if (seen.has(f.invoiceId)) continue;
      if (byId.get(f.invoiceId)?.status === 'paid') seen.add(f.invoiceId);
    }
    return seen.size;
  }, windows);

  return { gross, paidInvoices, failedAttempts, recovered };
}

export interface RefundActivity {
  count: Record<WindowKey, number>;
  amount: Record<WindowKey, ByCurrency>;
}

export function summarizeRefunds(refunds: RefundLike[], windows: Windows): RefundActivity {
  return {
    count: perWindow((w) => refunds.filter((r) => stripeTsInWindow(r.created, w)).length, windows),
    amount: perWindow((w) => {
      const total: ByCurrency = {};
      for (const r of refunds) if (stripeTsInWindow(r.created, w)) addMoney(total, r.currency, r.amount);
      return total;
    }, windows),
  };
}

export interface CheckoutActivity {
  created: Record<WindowKey, number>;
  completed: Record<WindowKey, number>;
}

export function summarizeCheckouts(sessions: CheckoutSessionLike[], windows: Windows): CheckoutActivity {
  return {
    created: perWindow((w) => sessions.filter((s) => stripeTsInWindow(s.created, w)).length, windows),
    completed: perWindow(
      (w) => sessions.filter((s) => s.status === 'complete' && stripeTsInWindow(s.created, w)).length,
      windows
    ),
  };
}

// ---------------------------------------------------------------------------
// Octree-only filtering (the Stripe account is shared with another product)
// ---------------------------------------------------------------------------

/** The id behind a customer/subscription reference, or null. */
export function refId(ref: string | { id: string } | null | undefined): string | null {
  if (!ref) return null;
  return typeof ref === 'string' ? ref : ref.id ?? null;
}

export function isOctreeSubscriptionLike(sub: Pick<SubscriptionLike, 'metadata'>): boolean {
  return isOctreeSubscription({ metadata: sub.metadata ?? {} });
}

export function isOctreeSessionLike(session: Pick<CheckoutSessionLike, 'mode' | 'metadata'>): boolean {
  return isOctreeCheckoutSession({
    mode: (session.mode ?? 'payment') as Stripe.Checkout.Session.Mode,
    metadata: session.metadata ?? {},
  });
}

/** What the invoice/refund filters need to know about Octree's side of the account. */
export interface OctreeStripeContext {
  subscriptionIds: Set<string>;
  customers: Set<string>;
}

/** Built from subscriptions and sessions that are already known to be Octree's. */
export function buildOctreeContext(
  subscriptions: Pick<SubscriptionLike, 'id' | 'customer'>[],
  sessions: Pick<CheckoutSessionLike, 'customer'>[]
): OctreeStripeContext {
  const customers = new Set<string>();
  for (const obj of [...subscriptions, ...sessions]) {
    const id = refId(obj.customer);
    if (id) customers.add(id);
  }
  return { subscriptionIds: new Set(subscriptions.map((s) => s.id)), customers };
}

/** An invoice is Octree's when it bills an Octree subscription or an Octree customer. */
export function isOctreeInvoice(
  invoice: Pick<InvoiceLike, 'customer' | 'subscription'>,
  ctx: OctreeStripeContext
): boolean {
  const subscriptionId = refId(invoice.subscription);
  if (subscriptionId && ctx.subscriptionIds.has(subscriptionId)) return true;
  const customerId = refId(invoice.customer);
  return Boolean(customerId && ctx.customers.has(customerId));
}

/**
 * A refund is Octree's when its (expanded) charge carries Octree's checkout
 * metadata (`checkoutMetadata()` goes on the PaymentIntent and Stripe copies
 * it onto the Charge): `app` decides when set, otherwise the charge counts
 * when it belongs to an Octree customer or carries `plan` (the other
 * product's charges never do). An unexpanded charge id cannot be attributed
 * and is left out.
 */
export function isOctreeRefund(refund: Pick<RefundLike, 'charge'>, ctx: OctreeStripeContext): boolean {
  const charge = refund.charge;
  if (!charge || typeof charge === 'string') return false;
  const app = charge.metadata?.app;
  if (app) return app === OCTREE_STRIPE_APP;
  const customerId = refId(charge.customer);
  if (customerId && ctx.customers.has(customerId)) return true;
  return Boolean(charge.metadata?.plan);
}

export interface StripeObjects<I extends InvoiceLike = InvoiceLike> {
  subscriptions: SubscriptionLike[];
  sessions: CheckoutSessionLike[];
  invoices: I[];
  refunds: RefundLike[];
  /** `data.object` of each `invoice.payment_failed` event, with the event time. */
  failures: { invoice: InvoiceLike; created: number }[];
}

/** Keeps only Octree's subscriptions, sessions, invoices, refunds and failures. */
export function filterOctreeStripeObjects<I extends InvoiceLike>(
  objects: StripeObjects<I>
): StripeObjects<I> & { ctx: OctreeStripeContext } {
  const subscriptions = objects.subscriptions.filter(isOctreeSubscriptionLike);
  const sessions = objects.sessions.filter(isOctreeSessionLike);
  const ctx = buildOctreeContext(subscriptions, sessions);
  return {
    subscriptions,
    sessions,
    invoices: objects.invoices.filter((i) => isOctreeInvoice(i, ctx)),
    refunds: objects.refunds.filter((r) => isOctreeRefund(r, ctx)),
    failures: objects.failures.filter((f) => isOctreeInvoice(f.invoice, ctx)),
    ctx,
  };
}

// ---------------------------------------------------------------------------
// Daily series (7-day sparkline row)
// ---------------------------------------------------------------------------

export interface DailyPoint {
  /** YYYY-MM-DD (UTC). */
  day: string;
  signups: number;
  paid: number;
}

export function utcDayKey(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** Buckets sign-up and paid-conversion timestamps into the 7 days before `end`. */
export function buildDailySeries(
  signupIso: string[],
  paidStripeTs: number[],
  windows: Windows
): DailyPoint[] {
  const points: DailyPoint[] = [];
  for (let i = 7; i >= 1; i--) {
    points.push({ day: utcDayKey(windows.d7.end - i * DAY_MS), signups: 0, paid: 0 });
  }
  const index = new Map(points.map((p, i) => [p.day, i]));

  for (const iso of signupIso) {
    const ms = Date.parse(iso);
    if (Number.isNaN(ms)) continue;
    const i = index.get(utcDayKey(ms));
    if (i !== undefined) points[i].signups += 1;
  }
  for (const ts of paidStripeTs) {
    const i = index.get(utcDayKey(ts * 1000));
    if (i !== undefined) points[i].paid += 1;
  }
  return points;
}

// ---------------------------------------------------------------------------
// Stripe data pull
// ---------------------------------------------------------------------------

export interface StripeDigest {
  mrr: MrrSummary;
  subscriptions: SubscriptionActivity;
  invoices: InvoiceActivity;
  refunds: RefundActivity;
  checkouts: CheckoutActivity;
  /** Creation timestamps of subscriptions (for the daily series). */
  paidConversionTs: number[];
}

const PAGE_LIMIT = 5000;

/**
 * Pulls the last 30 days of Stripe activity and summarises it.
 *
 * The Stripe account is shared with another product (filerenamerai.com), so
 * every list is filtered to Octree's objects (`filterOctreeStripeObjects`)
 * before anything is counted.
 */
export async function fetchStripeDigest(stripe: Stripe, windows: Windows): Promise<StripeDigest> {
  const since = Math.floor(windows.d30.start / 1000);

  const [subscriptions, invoices, refunds, sessions, failureEvents] = await Promise.all([
    stripe.subscriptions.list({ status: 'all', limit: 100 }).autoPagingToArray({ limit: PAGE_LIMIT }),
    stripe.invoices.list({ created: { gte: since }, limit: 100 }).autoPagingToArray({ limit: PAGE_LIMIT }),
    stripe.refunds
      .list({ created: { gte: since }, limit: 100, expand: ['data.charge'] })
      .autoPagingToArray({ limit: PAGE_LIMIT }),
    stripe.checkout.sessions
      .list({ created: { gte: since }, limit: 100 })
      .autoPagingToArray({ limit: PAGE_LIMIT }),
    stripe.events
      .list({ types: ['invoice.payment_failed'], created: { gte: since }, limit: 100 })
      .autoPagingToArray({ limit: PAGE_LIMIT }),
  ]);

  const octree = filterOctreeStripeObjects<InvoiceLike>({
    subscriptions: subscriptions as SubscriptionLike[],
    sessions: sessions as CheckoutSessionLike[],
    invoices: invoices as InvoiceLike[],
    refunds: refunds as RefundLike[],
    failures: failureEvents.map((event) => ({
      invoice: event.data.object as InvoiceLike,
      created: event.created,
    })),
  });

  const failures: PaymentFailureLike[] = octree.failures.map((f) => ({
    invoiceId: f.invoice.id,
    created: f.created,
  }));

  // Failed invoices older than the invoice window still need a current status
  // to decide whether they were recovered.
  const known = new Set(octree.invoices.map((i) => i.id));
  const missing = [...new Set(failures.map((f) => f.invoiceId).filter((id) => !known.has(id)))];
  const extra: InvoiceLike[] = [];
  for (const id of missing) {
    try {
      const invoice: InvoiceLike = await stripe.invoices.retrieve(id);
      if (isOctreeInvoice(invoice, octree.ctx)) extra.push(invoice);
    } catch {
      // Deleted or inaccessible invoice: it simply does not count as recovered.
    }
  }
  const allInvoices: InvoiceLike[] = [...octree.invoices, ...extra];

  const subs = octree.subscriptions;

  return {
    mrr: computeMrr(subs),
    subscriptions: summarizeSubscriptions(subs, windows),
    invoices: summarizeInvoices(allInvoices, failures, windows),
    refunds: summarizeRefunds(octree.refunds, windows),
    checkouts: summarizeCheckouts(octree.sessions, windows),
    paidConversionTs: subs.filter((s) => !NEVER_STARTED.has(s.status)).map((s) => s.created),
  };
}

// ---------------------------------------------------------------------------
// Supabase data pull
// ---------------------------------------------------------------------------

export interface SupabaseDigest {
  signups: Record<WindowKey, number>;
  /** Users who signed up in the window and have finished onboarding. */
  onboardingCompleted: Record<WindowKey, number>;
  projectsCreated: Record<WindowKey, number>;
  draftsCreated: Record<WindowKey, number>;
  /** null when `drafts.consumed_at` (migration 20261018100000) is not applied yet. */
  draftsConsumed: Record<WindowKey, number> | null;
  /** Free users whose daily edit counter is at the limit today. */
  freeLimitUsersNow: number;
  /** Sign-up timestamps in the last 7 days (for the daily series). */
  signupTimestamps: string[];
  notes: string[];
}

type Db = SupabaseClient<any, any, any>;

async function countBetween(
  client: Db,
  table: string,
  column: string,
  window: Window,
  extra?: (q: any) => any
): Promise<number> {
  let query = client
    .from(table)
    .select('*', { count: 'exact', head: true })
    .gte(column, new Date(window.start).toISOString())
    .lt(column, new Date(window.end).toISOString());
  if (extra) query = extra(query);
  const { count, error } = await query;
  if (error) throw new Error(`${table}.${column}: ${error.message}`);
  return count ?? 0;
}

async function countPerWindow(
  client: Db,
  table: string,
  column: string,
  windows: Windows,
  extra?: (q: any) => any
): Promise<Record<WindowKey, number>> {
  const [yesterday, d7, d30] = await Promise.all(
    WINDOW_KEYS.map((k) => countBetween(client, table, column, windows[k], extra))
  );
  return { yesterday, d7, d30 };
}

export async function fetchSupabaseDigest(client: Db, windows: Windows, now: Date): Promise<SupabaseDigest> {
  const notes: string[] = [];

  const [signups, onboardingCompleted, projectsCreated, draftsCreated] = await Promise.all([
    countPerWindow(client, 'user_usage', 'created_at', windows),
    countPerWindow(client, 'user_usage', 'created_at', windows, (q) => q.eq('onboarding_completed', true)),
    countPerWindow(client, 'projects', 'created_at', windows),
    countPerWindow(client, 'drafts', 'created_at', windows),
  ]);

  let draftsConsumed: Record<WindowKey, number> | null = null;
  try {
    draftsConsumed = await countPerWindow(client, 'drafts', 'consumed_at', windows);
  } catch {
    notes.push('drafts.consumed_at is not available (migration 20261018100000_drafts_consumption not applied); consumed drafts not reported.');
  }

  const today = now.toISOString().slice(0, 10);
  const { count: freeLimitUsersNow, error: limitError } = await client
    .from('user_usage')
    .select('*', { count: 'exact', head: true })
    .eq('is_pro', false)
    .eq('daily_reset_date', today)
    .gte('edit_count', FREE_DAILY_EDIT_LIMIT);
  if (limitError) notes.push(`free-limit query failed: ${limitError.message}`);

  const { data: signupRows, error: signupError } = await client
    .from('user_usage')
    .select('created_at')
    .gte('created_at', new Date(windows.d7.start).toISOString())
    .lt('created_at', new Date(windows.d7.end).toISOString())
    .limit(5000);
  if (signupError) notes.push(`sign-up series query failed: ${signupError.message}`);

  notes.push(
    'AI edits served are not reported: user_usage only stores resettable counters (edit_count, monthly_edit_count), not a per-edit log.'
  );
  notes.push(
    'Onboarding completed is the share of the window cohort with onboarding_completed = true; plan at completion time is not recorded.'
  );

  return {
    signups,
    onboardingCompleted,
    projectsCreated,
    draftsCreated,
    draftsConsumed,
    freeLimitUsersNow: freeLimitUsersNow ?? 0,
    signupTimestamps: (signupRows ?? []).map((r: { created_at: string | null }) => r.created_at).filter(Boolean) as string[],
    notes,
  };
}

// ---------------------------------------------------------------------------
// Assembly
// ---------------------------------------------------------------------------

export interface DailyDigest {
  generatedAt: string;
  windows: Record<WindowKey, { label: string; start: string; end: string }>;
  stripe: Omit<StripeDigest, 'paidConversionTs'>;
  funnel: Omit<SupabaseDigest, 'signupTimestamps'>;
  daily: DailyPoint[];
}

export async function buildDailyDigest(input: {
  stripe: Stripe;
  supabase: Db;
  now?: Date;
}): Promise<DailyDigest> {
  const now = input.now ?? new Date();
  const windows = makeWindows(now);

  const [stripeDigest, supabaseDigest] = await Promise.all([
    fetchStripeDigest(input.stripe, windows),
    fetchSupabaseDigest(input.supabase, windows, now),
  ]);

  const { paidConversionTs, ...stripeRest } = stripeDigest;
  const { signupTimestamps, ...funnel } = supabaseDigest;

  return {
    generatedAt: now.toISOString(),
    windows: perWindow(
      (w) => ({ label: w.label, start: new Date(w.start).toISOString(), end: new Date(w.end).toISOString() }),
      windows
    ),
    stripe: stripeRest,
    funnel,
    daily: buildDailySeries(signupTimestamps, paidConversionTs, windows),
  };
}
