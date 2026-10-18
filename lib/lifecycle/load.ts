/**
 * Loads the rows the lifecycle selection needs from Supabase (service role),
 * the auth admin API and Stripe. Paginates everything: the tables are a few
 * thousand rows, well under what a single cron invocation can read.
 */
import type Stripe from 'stripe';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/database.types';
import { isWinbackPrecandidate, type LifecycleUserRow } from './select';

type Db = SupabaseClient<Database>;

const PAGE = 1000;

const UNDEFINED_TABLE = '42P01';

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
      if (error.code === UNDEFINED_TABLE && options.onMissingTable) {
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

export interface LifecycleRows {
  users: LifecycleUserRow[];
  suppressedEmails: string[];
  optedOutUserIds: string[];
  sent: Array<{ userId: string; template: string }>;
  /** Lifecycle tables the database does not have yet (migration pending). */
  missingTables: string[];
}

export async function loadLifecycleRows(supabase: Db): Promise<LifecycleRows> {
  const missingTables: string[] = [];
  const [authUsers, usage, projects, suppressions, prefs, sent] = await Promise.all([
    listAllAuthUsers(supabase),
    selectAll((from, to) =>
      supabase
        .from('user_usage')
        .select('user_id, edit_count, is_pro, subscription_status, stripe_customer_id, role, updated_at')
        .order('user_id')
        .range(from, to)
    ),
    selectAll((from, to) =>
      supabase.from('projects').select('user_id, created_at').order('id').range(from, to)
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
        supabase.from('lifecycle_emails').select('user_id, template').order('sent_at').range(from, to),
      { onMissingTable: () => missingTables.push('lifecycle_emails') }
    ),
  ]);

  const firstProject = new Map<string, string>();
  for (const project of projects) {
    if (!project.created_at) continue;
    const current = firstProject.get(project.user_id);
    if (!current || project.created_at < current) firstProject.set(project.user_id, project.created_at);
  }

  const usageByUser = new Map(usage.map((row) => [row.user_id, row]));

  const users: LifecycleUserRow[] = authUsers.map((user) => {
    const row = usageByUser.get(user.id);
    return {
      userId: user.id,
      email: user.email,
      createdAt: user.createdAt,
      editCount: row?.edit_count ?? 0,
      isPro: row?.is_pro ?? false,
      subscriptionStatus: row?.subscription_status ?? null,
      stripeCustomerId: row?.stripe_customer_id ?? null,
      usageUpdatedAt: row?.updated_at ?? null,
      role: row?.role ?? null,
      firstProjectAt: firstProject.get(user.id) ?? null,
      subscriptionEndedAt: null,
    };
  });

  return {
    users,
    suppressedEmails: suppressions.map((s) => s.email),
    optedOutUserIds: prefs.map((p) => p.user_id),
    sent: sent.map((s) => ({ userId: s.user_id, template: s.template })),
    missingTables,
  };
}

const LIVE_STATUSES = new Set<Stripe.Subscription.Status>(['active', 'trialing', 'past_due']);
/** A checkout that never completed is not a lapsed payer. */
const NEVER_PAID_STATUSES = new Set<Stripe.Subscription.Status>(['incomplete', 'incomplete_expired']);

/**
 * When a customer's subscriptions all ended: the latest `ended_at` (or
 * `canceled_at`) across the ones that actually ran, null while any is still
 * live or when the customer never had a paid subscription.
 */
export function subscriptionEndedAt(subscriptions: Array<Pick<Stripe.Subscription, 'status' | 'ended_at' | 'canceled_at'>>): string | null {
  let latest = 0;
  for (const sub of subscriptions) {
    if (LIVE_STATUSES.has(sub.status)) return null;
    if (NEVER_PAID_STATUSES.has(sub.status)) continue;
    const ended = sub.ended_at ?? sub.canceled_at;
    if (ended && ended > latest) latest = ended;
  }
  return latest ? new Date(latest * 1000).toISOString() : null;
}

/**
 * Fills `subscriptionEndedAt` for the win-back pre-candidates (lapsed Stripe
 * customers) with one `subscriptions.list` call each. Skips users whose
 * win-back was already sent so the daily run does not re-query Stripe for
 * them forever.
 */
export async function attachStripeLapses(stripe: Stripe, rows: LifecycleRows): Promise<{ looked_up: number }> {
  const alreadySent = new Set(rows.sent.filter((s) => s.template === 'winback').map((s) => s.userId));
  const suppressed = new Set(rows.suppressedEmails.map((e) => e.toLowerCase()));
  const optedOut = new Set(rows.optedOutUserIds);
  let lookedUp = 0;

  for (const user of rows.users) {
    if (!isWinbackPrecandidate(user) || alreadySent.has(user.userId) || optedOut.has(user.userId)) continue;
    if (user.email && suppressed.has(user.email.toLowerCase())) continue;
    try {
      const subs = await stripe.subscriptions.list({ customer: user.stripeCustomerId!, status: 'all', limit: 20 });
      lookedUp += 1;
      user.subscriptionEndedAt = subscriptionEndedAt(subs.data);
    } catch (error) {
      console.error(`[lifecycle] stripe lookup failed for ${user.stripeCustomerId}:`, error);
    }
  }
  return { looked_up: lookedUp };
}
