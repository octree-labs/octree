import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { stripe } from '@/lib/stripe';
import { isCronRequestAuthorized } from '@/lib/ops/config';
import { getUnsubscribeSecret } from '@/lib/email/unsubscribe';
import { SCHEDULED_LIFECYCLE_TEMPLATES } from '@/lib/email/lifecycle';
import { enabledTemplates } from '@/lib/lifecycle/config';
import { attachStripeLapses, loadLifecycleRows } from '@/lib/lifecycle/load';
import { DEFAULT_SEND_CAP, selectLifecycleCandidates } from '@/lib/lifecycle/select';
import { sendLifecycleBatch } from '@/lib/lifecycle/send';
import { createLifecycleDeps } from '@/lib/lifecycle/deps';
import { runBillingFollowUps } from '@/lib/lifecycle/billing-send';
import { getPostHogServer } from '@/lib/posthog-server';
import { AnalyticsEvents, type PurchasePlan } from '@/lib/analytics/events';
import { isPurchasePlan } from '@/lib/checkout-plans';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * Lifecycle and win-back emails, plus the billing-recovery follow-ups (the
 * payment-failed reminder after 5 days, the checkout offer after 48h; see
 * lib/lifecycle/billing-recovery.ts). Scheduled in `vercel.json` (14:30
 * UTC). `?dry=1` computes the candidates and returns counts plus the first
 * five user ids per template without sending or recording anything.
 */
export async function GET(request: Request) {
  if (!isCronRequestAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const dry = new URL(request.url).searchParams.get('dry') === '1';
  const secret = getUnsubscribeSecret();
  if (!secret) {
    return NextResponse.json({ error: 'EMAIL_UNSUBSCRIBE_SECRET (or CRON_SECRET) is not set' }, { status: 500 });
  }

  const supabase = createAdminClient();
  const enabled = enabledTemplates();
  const now = new Date();

  try {
    const rows = await loadLifecycleRows(supabase);
    // Stripe is read when win-back can send, and on a dry run so the batch
    // the flag would release is visible before it is switched on.
    const stripeLookups =
      dry || enabled.has('winback')
        ? await attachStripeLapses(stripe, rows)
        : { candidates: 0, stripe_requests: 0, truncated: false };

    const selection = selectLifecycleCandidates({
      ...rows,
      enabledTemplates: enabled,
      now,
      cap: DEFAULT_SEND_CAP,
    });

    const summary = Object.fromEntries(
      SCHEDULED_LIFECYCLE_TEMPLATES.map((template) => [
        template,
        {
          enabled: enabled.has(template),
          eligible: selection.eligible[template].length,
          queued: selection.toSend.filter((c) => c.template === template).length,
          first_user_ids: selection.eligible[template].slice(0, 5).map((c) => c.userId),
        },
      ])
    );

    const posthog = getPostHogServer();
    const deps = createLifecycleDeps(supabase, {
      secret,
      capture: (userId, template) => {
        posthog?.capture({
          distinctId: userId,
          event: AnalyticsEvents.LIFECYCLE_EMAIL_SENT,
          properties: { template, source: 'server' },
        });
      },
    });

    // Billing-recovery follow-ups: a dry run only counts; a live run sends
    // them before the scheduled batch (they are few and time-sensitive).
    // They dedupe on their own ledger rows, so a missing ledger (null from
    // the loader) means nothing goes out and the response says so.
    const billing = await runBillingFollowUps({
      stripe,
      supabase,
      deps,
      now,
      dry: dry || rows.missingTables.length > 0,
      onSent: (followUp, extra) => {
        const plan = followUp.payload.plan;
        const event =
          followUp.template === 'payment_failed_reminder'
            ? {
                event: AnalyticsEvents.PAYMENT_FAILED_EMAIL_SENT,
                properties: {
                  template: 'payment_failed_reminder' as const,
                  amount: extra.invoice?.amountCents != null ? extra.invoice.amountCents / 100 : null,
                  currency: extra.invoice?.currency ? extra.invoice.currency.toUpperCase() : null,
                  has_retry: extra.invoice?.nextPaymentAttempt != null,
                },
              }
            : {
                event: AnalyticsEvents.CHECKOUT_RECOVERY_EMAIL_SENT,
                properties: {
                  template: 'checkout_recovery_offer' as const,
                  plan: (typeof plan === 'string' && isPurchasePlan(plan) ? plan : 'unknown') as PurchasePlan | 'unknown',
                  has_offer: extra.promoCode !== null,
                },
              };
        posthog?.capture({ distinctId: followUp.userId, ...event, properties: { ...event.properties, source: 'server' } });
      },
    });

    if (dry) {
      return NextResponse.json({
        dry: true,
        generated_at: now.toISOString(),
        users: rows.users.length,
        stripe: stripeLookups,
        cap: DEFAULT_SEND_CAP,
        missing_tables: rows.missingTables,
        templates: summary,
        billing,
      });
    }

    // Without the ledger there is no dedupe, so a live run must not send.
    if (rows.missingTables.length > 0) {
      return NextResponse.json(
        { error: `lifecycle tables missing: ${rows.missingTables.join(', ')} (apply the migration)`, templates: summary },
        { status: 500 }
      );
    }

    const results = await sendLifecycleBatch(selection.toSend, deps);
    if (posthog) {
      await posthog.flush().catch((error) => console.error('[lifecycle] posthog flush failed:', error));
    }

    const sent = results.filter((r) => r.sent).length;
    const failed = results.filter((r) => !r.sent);
    return NextResponse.json({
      dry: false,
      generated_at: now.toISOString(),
      users: rows.users.length,
      stripe: stripeLookups,
      cap: DEFAULT_SEND_CAP,
      sent,
      failed: failed.length,
      failures: failed.slice(0, 20),
      templates: summary,
      billing,
    });
  } catch (error) {
    console.error('[lifecycle] run failed:', error);
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
