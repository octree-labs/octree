import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { stripe } from '@/lib/stripe';
import { isCronRequestAuthorized } from '@/lib/ops/config';
import { resend, FROM_ADDRESS } from '@/lib/email/client';
import { getAppUrl, getUnsubscribeSecret, userUnsubscribeUrl } from '@/lib/email/unsubscribe';
import { LIFECYCLE_TEMPLATES } from '@/lib/email/lifecycle';
import { enabledTemplates } from '@/lib/lifecycle/config';
import { attachStripeLapses, loadLifecycleRows } from '@/lib/lifecycle/load';
import { DEFAULT_SEND_CAP, selectLifecycleCandidates } from '@/lib/lifecycle/select';
import { sendLifecycleBatch, type LifecycleLedger, type LifecycleMailer } from '@/lib/lifecycle/send';
import { getPostHogServer } from '@/lib/posthog-server';
import { AnalyticsEvents } from '@/lib/analytics/events';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const TOOLS_URL = 'https://tools.useoctree.com';

/**
 * Lifecycle and win-back emails. Scheduled in `vercel.json` (14:30 UTC).
 * `?dry=1` computes the candidates and returns counts plus the first five
 * user ids per template without sending or recording anything.
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
    // Stripe is consulted even when winback is disabled so a dry run shows
    // the batch the flag would release.
    const stripeLookups = await attachStripeLapses(stripe, rows);

    const selection = selectLifecycleCandidates({
      ...rows,
      enabledTemplates: enabled,
      now,
      cap: DEFAULT_SEND_CAP,
    });

    const summary = Object.fromEntries(
      LIFECYCLE_TEMPLATES.map((template) => [
        template,
        {
          enabled: enabled.has(template),
          eligible: selection.eligible[template].length,
          queued: selection.toSend.filter((c) => c.template === template).length,
          first_user_ids: selection.eligible[template].slice(0, 5).map((c) => c.userId),
        },
      ])
    );

    if (dry) {
      return NextResponse.json({
        dry: true,
        generated_at: now.toISOString(),
        users: rows.users.length,
        stripe_lookups: stripeLookups.looked_up,
        cap: DEFAULT_SEND_CAP,
        missing_tables: rows.missingTables,
        templates: summary,
      });
    }

    // Without the ledger there is no dedupe, so a live run must not send.
    if (rows.missingTables.length > 0) {
      return NextResponse.json(
        { error: `lifecycle tables missing: ${rows.missingTables.join(', ')} (apply the migration)`, templates: summary },
        { status: 500 }
      );
    }

    const mailer: LifecycleMailer = {
      async send(input) {
        const { data, error } = await resend.emails.send({
          from: FROM_ADDRESS,
          to: input.to,
          subject: input.subject,
          html: input.html,
          text: input.text,
          headers: input.headers,
        });
        return { id: data?.id ?? null, error: error?.message ?? null };
      },
    };

    const ledger: LifecycleLedger = {
      async claim({ userId, email, template }) {
        const { error } = await supabase
          .from('lifecycle_emails')
          .insert({ user_id: userId, email, template });
        if (!error) return true;
        // 23505 = unique_violation: another run already claimed it.
        if (error.code === '23505') return false;
        throw new Error(error.message);
      },
      async markSent({ userId, template, resendId }) {
        const { error } = await supabase
          .from('lifecycle_emails')
          .update({ resend_id: resendId })
          .eq('user_id', userId)
          .eq('template', template);
        if (error) throw new Error(error.message);
      },
    };

    const posthog = getPostHogServer();
    const results = await sendLifecycleBatch(selection.toSend, {
      mailer,
      ledger,
      appUrl: getAppUrl(),
      toolsUrl: TOOLS_URL,
      unsubscribeUrl: (userId) => userUnsubscribeUrl(userId, secret),
      capture: (userId, template) => {
        posthog?.capture({
          distinctId: userId,
          event: AnalyticsEvents.LIFECYCLE_EMAIL_SENT,
          properties: { template, source: 'server' },
        });
      },
    });
    if (posthog) {
      await posthog.flush().catch((error) => console.error('[lifecycle] posthog flush failed:', error));
    }

    const sent = results.filter((r) => r.sent).length;
    const failed = results.filter((r) => !r.sent);
    return NextResponse.json({
      dry: false,
      generated_at: now.toISOString(),
      users: rows.users.length,
      stripe_lookups: stripeLookups.looked_up,
      cap: DEFAULT_SEND_CAP,
      sent,
      failed: failed.length,
      failures: failed.slice(0, 20),
      templates: summary,
    });
  } catch (error) {
    console.error('[lifecycle] run failed:', error);
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
