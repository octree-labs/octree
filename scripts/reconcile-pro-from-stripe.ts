/**
 * Reconciles `user_usage.is_pro` with Stripe.
 *
 * Lists every row with `is_pro = true`, asks Stripe about the subscription
 * each one names, and proposes an action per row using the rule in
 * lib/subscription/entitlement.ts (`reconcileDecision`):
 *
 *   revoke       Stripe says canceled / incomplete_expired, or 404
 *   keep         Stripe says active / trialing, or the row is a deliberate
 *                grant (`subscription_status = 'unlimited'`, allowlisted email)
 *   needs-owner  no subscription id (hand-set rows), or a Stripe status the
 *                webhook owns (paused, past_due, unpaid, incomplete). Never
 *                touched by this script.
 *
 * Dry run by default; nothing is written. `--apply` performs the `revoke`
 * rows only, through the service-role RPC `update_user_subscription_status`
 * (status `inactive`, so the RPC derives `is_pro = false`), the same path
 * GET /api/subscription-status uses to self-heal. No raw column writes.
 *
 *   npm run reconcile:pro               # dry run: table + summary
 *   npm run reconcile:pro -- --apply    # revoke the stale rows
 *
 * Environment (loaded from .env.local like the app; aliases are for a
 * read-only pair kept outside the app's env):
 *   NEXT_PUBLIC_SUPABASE_URL   or SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY  or SUPABASE_SECRET_KEY
 *   STRIPE_SECRET_KEY          or STRIPE_RESTRICTED_KEY (read-only: a dry
 *                              run works, `--apply` still only needs Supabase)
 *
 * Output never includes emails or full Stripe ids: the user id, the last six
 * characters of the subscription id, statuses and the proposed action.
 */
import { parseArgs } from 'util';
import { loadEnvConfig } from '@next/env';
import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';

import { hasUnlimitedEdits } from '@/lib/paywall';
import { effectiveSubscriptionStatus } from '@/lib/stripe-subscription';
import {
  reconcileDecision,
  type ReconcileAction,
  type StripeStatusReport,
} from '@/lib/subscription/entitlement';

loadEnvConfig(process.cwd());

interface UsageRow {
  user_id: string;
  is_pro: boolean;
  subscription_status: string | null;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  current_period_start: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean | null;
}

interface ReportRow {
  row: UsageRow;
  subSuffix: string;
  stripeStatus: StripeStatusReport;
  stripeSubscription: Stripe.Subscription | null;
  hasUnlimited: boolean;
  allowlistUnknown: boolean;
  action: ReconcileAction;
  reason: string;
}

function requireEnv(...names: string[]): string {
  for (const name of names) {
    const value = process.env[name];
    if (value) return value;
  }
  console.error(`Missing environment variable: set one of ${names.join(', ')}.`);
  process.exit(1);
}

function suffix(id: string | null): string {
  if (!id) return 'none';
  return id.slice(-6);
}

function dateOnly(iso: string | null): string {
  if (!iso) return '-';
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? new Date(ms).toISOString().slice(0, 10) : iso;
}

async function stripeStatusFor(
  stripe: Stripe,
  subscriptionId: string
): Promise<{ status: StripeStatusReport; subscription: Stripe.Subscription | null }> {
  try {
    const subscription = await stripe.subscriptions.retrieve(subscriptionId);
    return { status: effectiveSubscriptionStatus(subscription), subscription };
  } catch (error: any) {
    if (error?.code === 'resource_missing' || error?.statusCode === 404) {
      return { status: 'missing', subscription: null };
    }
    throw error;
  }
}

function markdownTable(rows: ReportRow[]): string {
  const header = ['user id', 'sub id (last 6)', 'db status', 'period end', 'Stripe status', 'action', 'reason'];
  const lines = rows.map((r) => [
    r.row.user_id,
    r.subSuffix,
    r.row.subscription_status ?? 'null',
    dateOnly(r.row.current_period_end),
    r.stripeStatus ?? (r.row.stripe_subscription_id ? 'unknown' : 'no subscription id'),
    r.action,
    r.reason + (r.allowlistUnknown ? ' (allowlist unknown)' : ''),
  ]);
  const widths = header.map((h, i) => Math.max(h.length, ...lines.map((l) => l[i].length)));
  const fmt = (cells: string[]) => `| ${cells.map((c, i) => c.padEnd(widths[i])).join(' | ')} |`;
  return [fmt(header), `|${widths.map((w) => '-'.repeat(w + 2)).join('|')}|`, ...lines.map(fmt)].join('\n');
}

async function main() {
  const { values } = parseArgs({
    options: { apply: { type: 'boolean', default: false } },
  });
  const apply = Boolean(values.apply);

  const supabaseUrl = requireEnv('NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_URL');
  const supabaseKey = requireEnv('SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SECRET_KEY');
  const stripeKey = requireEnv('STRIPE_SECRET_KEY', 'STRIPE_RESTRICTED_KEY');

  const supabase = createClient(supabaseUrl, supabaseKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const stripe = new Stripe(stripeKey);
  const mode = stripeKey.includes('_live_') ? 'live' : 'test';

  console.log(`${apply ? 'APPLY' : 'Dry run'}: reconciling is_pro rows against Stripe (${mode} mode)\n`);

  const { data, error } = await supabase
    .from('user_usage')
    .select(
      'user_id, is_pro, subscription_status, stripe_customer_id, stripe_subscription_id, current_period_start, current_period_end, cancel_at_period_end'
    )
    .eq('is_pro', true)
    .order('user_id');
  if (error) {
    console.error('Failed to read user_usage:', error.message);
    process.exit(1);
  }
  const rows = (data ?? []) as UsageRow[];

  const report: ReportRow[] = [];
  for (const row of rows) {
    // The allowlist is by email, which is only needed here and never printed.
    let hasUnlimited = false;
    let allowlistUnknown = false;
    try {
      const { data: userData, error: userError } = await supabase.auth.admin.getUserById(row.user_id);
      if (userError) throw userError;
      hasUnlimited = hasUnlimitedEdits(userData.user?.email);
    } catch {
      allowlistUnknown = true;
    }

    let stripeStatus: StripeStatusReport = null;
    let stripeSubscription: Stripe.Subscription | null = null;
    if (row.stripe_subscription_id) {
      const looked = await stripeStatusFor(stripe, row.stripe_subscription_id);
      stripeStatus = looked.status;
      stripeSubscription = looked.subscription;
    }

    let { action, reason } = reconcileDecision({ row, stripeStatus, hasUnlimited });
    if (action === 'revoke' && allowlistUnknown) {
      // Could not rule out the allowlist: leave it to the owner.
      action = 'needs-owner';
      reason = `${reason}; could not read the account email`;
    }

    report.push({
      row,
      subSuffix: suffix(row.stripe_subscription_id),
      stripeStatus,
      stripeSubscription,
      hasUnlimited,
      allowlistUnknown,
      action,
      reason,
    });
  }

  console.log(markdownTable(report));

  const counts: Record<ReconcileAction, number> = { revoke: 0, keep: 0, 'needs-owner': 0 };
  for (const r of report) counts[r.action] += 1;
  console.log('\nSummary');
  console.log(`  is_pro = true rows : ${report.length}`);
  console.log(`  keep               : ${counts.keep}`);
  console.log(`  revoke             : ${counts.revoke}`);
  console.log(`  needs-owner        : ${counts['needs-owner']}`);

  if (!apply) {
    console.log('\nDry run: nothing written. Re-run with --apply to revoke the rows marked `revoke`.');
    return;
  }

  const revokes = report.filter((r) => r.action === 'revoke');
  if (revokes.length === 0) {
    console.log('\nNothing to revoke.');
    return;
  }

  console.log(`\nRevoking ${revokes.length} row(s) through update_user_subscription_status...`);
  let failed = 0;
  for (const r of revokes) {
    const sub = r.stripeSubscription;
    const periodStart = sub?.current_period_start
      ? new Date(sub.current_period_start * 1000).toISOString()
      : r.row.current_period_start;
    const periodEnd = sub?.current_period_end
      ? new Date(sub.current_period_end * 1000).toISOString()
      : r.row.current_period_end;
    const customerId =
      r.row.stripe_customer_id ?? (typeof sub?.customer === 'string' ? sub.customer : sub?.customer?.id ?? null);

    const { error: rpcError } = await supabase.rpc('update_user_subscription_status', {
      p_user_id: r.row.user_id,
      p_stripe_customer_id: customerId,
      p_stripe_subscription_id: r.row.stripe_subscription_id,
      p_subscription_status: 'inactive',
      p_current_period_start: periodStart,
      p_current_period_end: periodEnd,
      p_cancel_at_period_end: sub?.cancel_at_period_end ?? r.row.cancel_at_period_end ?? false,
    });
    if (rpcError) {
      failed += 1;
      console.log(`  ${r.row.user_id}  ...${r.subSuffix}  FAILED: ${rpcError.message}`);
    } else {
      console.log(`  ${r.row.user_id}  ...${r.subSuffix}  revoked (${r.reason})`);
    }
  }

  console.log(`\nDone: ${revokes.length - failed} revoked, ${failed} failed.`);
  if (failed > 0) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
