import { NextResponse } from 'next/server';

import { AnalyticsEvents, type LifecycleEmailTemplate } from '@/lib/analytics/events';
import { LIFECYCLE_TEMPLATES } from '@/lib/email/lifecycle';
import { linkForAnalytics, parseResendWebhook, verifySvixSignature } from '@/lib/email/resend-webhook';
import { captureServerEventAfterResponse, captureServerExceptionAfterResponse } from '@/lib/posthog-server';
import { createAdminClient } from '@/lib/supabase/admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Resend engagement webhook: `email.opened` and `email.clicked` become
 * PostHog `email_opened` / `email_clicked` for the user the email went to.
 * The message id in the payload is looked up in `lifecycle_emails.resend_id`
 * (written by the ledger's markSent, lib/lifecycle/deps.ts), so only the
 * lifecycle and billing-recovery emails are tracked; a transactional email
 * sent outside the ledger answers 200 and records nothing.
 *
 * Fails closed: without RESEND_WEBHOOK_SECRET every delivery is refused with
 * 503, and a bad or stale signature with 400. Resend retries on 5xx, so a
 * database error is a 500 and a payload this route does not act on is 200.
 *
 * Set-up (Resend dashboard > Webhooks): endpoint
 * https://app.useoctree.com/api/webhooks/resend, events `email.opened` and
 * `email.clicked`; copy the signing secret to RESEND_WEBHOOK_SECRET. Open
 * and click tracking must be on for the sending domain for either event to
 * fire at all.
 */
export async function POST(request: Request) {
  const secret = process.env.RESEND_WEBHOOK_SECRET?.trim();
  if (!secret) {
    return NextResponse.json({ error: 'RESEND_WEBHOOK_SECRET is not set' }, { status: 503 });
  }

  const body = await request.text();
  const verified = verifySvixSignature({
    secret,
    id: request.headers.get('svix-id'),
    timestamp: request.headers.get('svix-timestamp'),
    signature: request.headers.get('svix-signature'),
    body,
  });
  if (!verified) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
  }

  const parsed = parseResendWebhook(body);
  if (parsed.kind === 'invalid') {
    return NextResponse.json({ error: 'Unrecognised payload' }, { status: 400 });
  }
  if (parsed.kind === 'ignored') {
    return NextResponse.json({ received: true, ignored: parsed.type });
  }

  const { event } = parsed;
  try {
    const supabase = createAdminClient();
    const { data, error } = await supabase
      .from('lifecycle_emails')
      .select('user_id, template')
      .eq('resend_id', event.emailId)
      .limit(1);
    if (error) throw new Error(error.message);

    const row = data?.[0];
    if (!row) return NextResponse.json({ received: true, unknown_email: true });
    if (!(LIFECYCLE_TEMPLATES as readonly string[]).includes(row.template)) {
      return NextResponse.json({ received: true, unknown_template: true });
    }
    const template = row.template as LifecycleEmailTemplate;

    if (event.type === 'email.clicked') {
      captureServerEventAfterResponse(row.user_id, AnalyticsEvents.EMAIL_CLICKED, {
        template,
        link: linkForAnalytics(event.link),
      });
    } else {
      captureServerEventAfterResponse(row.user_id, AnalyticsEvents.EMAIL_OPENED, { template });
    }
    return NextResponse.json({ received: true });
  } catch (error) {
    console.error('[resend-webhook] failed:', error);
    captureServerExceptionAfterResponse(error, { route: 'api/webhooks/resend', extra: { type: event.type } });
    return NextResponse.json({ error: 'Webhook processing failed' }, { status: 500 });
  }
}
