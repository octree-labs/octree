/**
 * Loads the rows the lifecycle selection needs from Supabase (service role),
 * the auth admin API and Stripe. Paginates everything: the tables are a few
 * thousand rows, well under what a single cron invocation can read.
 */
import type Stripe from 'stripe';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/database.types';
import { isWinbackPrecandidate, LIFECYCLE_RULES, type LifecycleUserRow, type PaywallHit } from './select';

type Db = SupabaseClient<Database>;

const PAGE = 1000;

/**
 * Postgres `undefined_table`, and PostgREST's schema-cache version of it
 * (PGRST205, what a select on a table that does not exist returns from
 * PostgREST 12 on, i.e. hosted Supabase today).
 */
const UNDEFINED_TABLE = new Set(['42P01', 'PGRST205']);
/** Postgres `undefined_column`, and PostgREST's schema-cache version of it. */
const UNDEFINED_COLUMN = new Set(['42703', 'PGRST204']);

/** A read or write that failed because the lifecycle migration is pending. */
export function isMissingLedgerSchema(error: { code?: string } | null | undefined): boolean {
  return !!error?.code && (UNDEFINED_TABLE.has(error.code) || UNDEFINED_COLUMN.has(error.code));
}

/**
 * A claimed ledger row whose send failed (`error` set, no `resend_id`) is
 * retried on later runs, at most this many times in total.
 */
export const MAX_SEND_ATTEMPTS = 3;

async function selectAll<T>(
  query: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string; code?: string } | null }>,
  options: { onMissingTable?: () => void } = {}
): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await query(from, from + PAGE - 1);
    if (error) {
      // The lifecycle tables arrive with the migration in this change; a dry
      // run before it is applied should still report candidates.
      if (isMissingLedgerSchema(error) && options.onMissingTable) {
        options.onMissingTable();
        return rows;
      }
      throw new Error(error.message);
    }
    if (!data || data.length === 0) break;
    rows.push(...data);
    if (data.length < PAGE) break;
  }
  return rows;
}

export interface AuthUserLite {
  id: string;
  email: string | null;
  createdAt: string | null;
}

/** Every auth user, via the admin API, 1000 per page. */
export async function listAllAuthUsers(supabase: Db): Promise<AuthUserLite[]> {
  const users: AuthUserLite[] = [];
  for (let page = 1; ; page += 1) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: PAGE });
    if (error) throw new Error(error.message);
    for (const user of data.users) {
      users.push({ id: user.id, email: user.email ?? null, createdAt: user.created_at ?? null });
    }
    if (data.users.length < PAGE) break;
  }
  return users;
}

export interface LedgerRow {
  userId: string;
  template: string;
  /** '' for the scheduled templates (see migration 20261019010000). */
  ref?: string;
  resendId: string | null;
  error: string | null;
  attempts: number;
}

/**
 * A ledger row still blocks the (user, template) pair unless its send
 * failed and it has attempts left. A row with neither `resend_id` nor
 * `error` is in flight (or sent with the id lost) and counts as sent.
 */
export function isRetryable(row: LedgerRow): boolean {
  return row.resendId === null && row.error !== null && row.attempts < MAX_SEND_ATTEMPTS;
}

export interface LifecycleRows {
  users: LifecycleUserRow[];
  suppressedEmails: string[];
  optedOutUserIds: string[];
  /** Ledger rows that still block a send (see `isRetryable`). */
  sent: Array<{ userId: string; template: string; ref: string }>;
  /** Lifecycle tables (or columns) the database does not have yet (migration pending). */
  missingTables: string[];
  /**
   * Input-only tables that are not there yet (paywall_hits, migration
   * 20261021120000). Unlike `missingTables` they do not stop a live run:
   * without them the templates that read them (warm_lead_offer) simply
   * find nobody, and everything else sends as before.
   */
  missingOptionalTables?: string[];
}

export async function loadLifecycleRows(supabase: Db, now: Date = new Date()): Promise<LifecycleRows> {
  const missingTables: string[] = [];
  const missingOptionalTables: string[] = [];
  const paywallSince = new Date(now.getTime() - LIFECYCLE_RULES.warm_lead_offer.lookbackMs).toISOString();
  const [authUsers, usage, projects, generated, suppressions, prefs, ledger, paywallHits, creditBuyers, generationBuyers] = await Promise.all([
    listAllAuthUsers(supabase),
    selectAll((from, to) =>
      supabase
        .from('user_usage')
        .select(
          'user_id, edit_count, daily_reset_date, is_pro, subscription_status, stripe_customer_id, stripe_subscription_id, current_period_start, current_period_end, updated_at, role'
        )
        .order('user_id')
        .range(from, to)
    ),
    selectAll((from, to) =>
      supabase.from('projects').select('user_id, created_at, updated_at').order('id').range(from, to)
    ),
    // Only the timestamps: a generation is activity for the pro_inactive rule.
    selectAll((from, to) =>
      supabase.from('generated_documents').select('user_id, created_at').order('id').range(from, to)
    ),
    selectAll((from, to) => supabase.from('email_suppressions').select('email').order('email').range(from, to)),
    selectAll(
      (from, to) =>
        supabase
          .from('email_preferences')
          .select('user_id')
          .eq('marketing_opt_out', true)
          .order('user_id')
          .range(from, to),
      { onMissingTable: () => missingTables.push('email_preferences') }
    ),
    selectAll(
      (from, to) =>
        supabase
          .from('lifecycle_emails')
          .select('user_id, template, ref, resend_id, error, attempts')
          .order('id')
          .range(from, to),
      // `ref` arrives with migration 20261019010000; before it the select
      // fails with undefined_column and is reported like a missing table.
      { onMissingTable: () => missingTables.push('lifecycle_emails') }
    ),
    // The last week of paywall hits, for warm_lead_offer.
    selectAll(
      (from, to) =>
        supabase
          .from('paywall_hits')
          .select('id, user_id, feature, reason, created_at')
          .gte('created_at', paywallSince)
          .order('id')
          .range(from, to),
      { onMissingTable: () => missingOptionalTables.push('paywall_hits') }
    ),
    // Anyone who bought a credit pack or a single generation has paid
    // before: warm_lead_offer's first-time-only code would be refused.
    selectAll(
      (from, to) => supabase.from('credit_purchases').select('user_id').order('id').range(from, to),
      { onMissingTable: () => missingOptionalTables.push('credit_purchases') }
    ),
    selectAll(
      (from, to) => supabase.from('generation_purchases').select('user_id').order('id').range(from, to),
      { onMissingTable: () => missingOptionalTables.push('generation_purchases') }
    ),
  ]);
  const oneOffBuyers = new Set([...creditBuyers, ...generationBuyers].map((row) => row.user_id));

  const lastHit = new Map<string, PaywallHit>();
  for (const hit of paywallHits) {
    if (!hit.created_at) continue;
    const current = lastHit.get(hit.user_id);
    // Compared as instants: PostgREST may format offsets differently.
    if (!current || Date.parse(hit.created_at) > Date.parse(current.createdAt)) {
      lastHit.set(hit.user_id, { feature: hit.feature, reason: hit.reason, createdAt: hit.created_at });
    }
  }

  const firstProject = new Map<string, string>();
  const lastActivity = new Map<string, string>();
  const noteActivity = (userId: string, at: string | null | undefined) => {
    if (!at) return;
    const current = lastActivity.get(userId);
    if (!current || at > current) lastActivity.set(userId, at);
  };
  for (const project of projects) {
    if (!project.created_at) continue;
    const current = firstProject.get(project.user_id);
    if (!current || project.created_at < current) firstProject.set(project.user_id, project.created_at);
    noteActivity(project.user_id, project.updated_at ?? project.created_at);
  }
  for (const doc of generated) noteActivity(doc.user_id, doc.created_at);
  for (const row of usage) {
    // user_usage.updated_at moves on every counted AI edit (increment_edit_count,
    // both branches) and every generation (consume_generation); it is the only
    // edit signal for Pro users, whose branch of increment_edit_count never
    // touches daily_reset_date. It also moves on the subscription writes of
    // the Stripe webhook, which only ever makes someone look more recently
    // active, never less.
    noteActivity(row.user_id, row.updated_at);
    // daily_reset_date is a date (`YYYY-MM-DD`): the day the free counter
    // started, moved by increment_edit_count on the first edit of a new day.
    // As an ISO string it sorts correctly against the timestamps above.
    noteActivity(row.user_id, row.daily_reset_date);
  }

  const usageByUser = new Map(usage.map((row) => [row.user_id, row]));

  const users: LifecycleUserRow[] = authUsers.map((user) => {
    const row = usageByUser.get(user.id);
    return {
      userId: user.id,
      email: user.email,
      createdAt: user.createdAt,
      editCount: row?.edit_count ?? 0,
      dailyResetDate: row?.daily_reset_date ?? null,
      isPro: row?.is_pro ?? false,
      subscriptionStatus: row?.subscription_status ?? null,
      stripeCustomerId: row?.stripe_customer_id ?? null,
      stripeSubscriptionId: row?.stripe_subscription_id ?? null,
      currentPeriodStart: row?.current_period_start ?? null,
      currentPeriodEnd: row?.current_period_end ?? null,
      role: row?.role ?? null,
      firstProjectAt: firstProject.get(user.id) ?? null,
      subscriptionEndedAt: null,
      lastActivityAt: lastActivity.get(user.id) ?? null,
      lastPaywallHit: lastHit.get(user.id) ?? null,
      hasOneOffPurchase: oneOffBuyers.has(user.id),
    };
  });

  const sent = ledger
    .map((row) => ({
      userId: row.user_id,
      template: row.template,
      ref: row.ref ?? '',
      resendId: row.resend_id,
      error: row.error,
      attempts: row.attempts,
    }))
    .filter((row) => !isRetryable(row))
    .map(({ userId, template, ref }) => ({ userId, template, ref }));

  return {
    users,
    suppressedEmails: suppressions.map((s) => s.email),
    optedOutUserIds: prefs.map((p) => p.user_id),
    sent,
    missingTables,
    missingOptionalTables,
  };
}

const LIVE_STATUSES = new Set<Stripe.Subscription.Status>(['active', 'trialing', 'past_due']);
/** A checkout that never completed is not a lapsed payer. */
const NEVER_PAID_STATUSES = new Set<Stripe.Subscription.Status>(['incomplete', 'incomplete_expired']);

export type SubscriptionLite = Pick<Stripe.Subscription, 'status' | 'ended_at' | 'canceled_at'>;

/**
 * When a customer's subscriptions all ended: the latest `ended_at` (or
 * `canceled_at`) across the ones that actually ran, null while any is still
 * live or when the customer never had a paid subscription. A paused
 * subscription (PR #398) is `active` to Stripe, so it counts as live here.
 */
export function subscriptionEndedAt(subscriptions: SubscriptionLite[]): string | null {
  let latest = 0;
  for (const sub of subscriptions) {
    if (LIVE_STATUSES.has(sub.status)) return null;
    if (NEVER_PAID_STATUSES.has(sub.status)) continue;
    const ended = sub.ended_at ?? sub.canceled_at;
    if (ended && ended > latest) latest = ended;
  }
  return latest ? new Date(latest * 1000).toISOString() : null;
}

/** Upper bound on `subscriptions.list` pages per run (100 subscriptions each). */
export const MAX_STRIPE_PAGES = 100;

/**
 * Fills `subscriptionEndedAt` for the win-back pre-candidates. One
 * `subscriptions.list({ status: 'all' })` pass over the whole account,
 * grouped by customer, instead of a call per candidate: the cost is
 * ceil(total subscriptions / 100) requests a day whatever the number of
 * lapsed users, and the answer is always current. Skips the pass entirely
 * when no candidate still needs the answer (already sent, suppressed or
 * opted out).
 */
export async function attachStripeLapses(
  stripe: Pick<Stripe, 'subscriptions'>,
  rows: LifecycleRows
): Promise<{ candidates: number; stripe_requests: number; truncated: boolean }> {
  const alreadySent = new Set(rows.sent.filter((s) => s.template === 'winback').map((s) => s.userId));
  const suppressed = new Set(rows.suppressedEmails.map((e) => e.toLowerCase()));
  const optedOut = new Set(rows.optedOutUserIds);

  const byCustomer = new Map<string, LifecycleUserRow[]>();
  for (const user of rows.users) {
    if (!isWinbackPrecandidate(user) || alreadySent.has(user.userId) || optedOut.has(user.userId)) continue;
    if (user.email && suppressed.has(user.email.toLowerCase())) continue;
    const list = byCustomer.get(user.stripeCustomerId!) ?? [];
    list.push(user);
    byCustomer.set(user.stripeCustomerId!, list);
  }
  if (byCustomer.size === 0) return { candidates: 0, stripe_requests: 0, truncated: false };

  const subsByCustomer = new Map<string, SubscriptionLite[]>();
  let requests = 0;
  let truncated = false;
  let startingAfter: string | undefined;
  for (;;) {
    if (requests >= MAX_STRIPE_PAGES) {
      truncated = true;
      console.error(`[lifecycle] stripe subscription list truncated after ${requests} pages`);
      break;
    }
    const page = await stripe.subscriptions.list({ status: 'all', limit: 100, starting_after: startingAfter });
    requests += 1;
    for (const sub of page.data) {
      const customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer.id;
      if (!byCustomer.has(customerId)) continue;
      const list = subsByCustomer.get(customerId) ?? [];
      list.push({ status: sub.status, ended_at: sub.ended_at, canceled_at: sub.canceled_at });
      subsByCustomer.set(customerId, list);
    }
    if (!page.has_more || page.data.length === 0) break;
    startingAfter = page.data[page.data.length - 1].id;
  }

  // A truncated listing could miss a customer's live subscription, which
  // would read as "lapsed"; leave everyone unknown rather than guess.
  if (!truncated) {
    for (const [customerId, users] of byCustomer) {
      const ended = subscriptionEndedAt(subsByCustomer.get(customerId) ?? []);
      for (const user of users) user.subscriptionEndedAt = ended;
    }
  }

  let candidates = 0;
  for (const users of byCustomer.values()) candidates += users.length;
  return { candidates, stripe_requests: requests, truncated };
}
