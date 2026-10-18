import { resend, FROM_ADDRESS } from '@/lib/email/client';
import { getOpsAlertEmail } from './config';

export type OpsEmailResult =
  | { sent: true; to: string; id: string | null }
  | { sent: false; reason: string };

/**
 * Sends an operational email to OPS_ALERT_EMAIL. Skips (without throwing)
 * when the address is not configured so the cron routes still return their
 * JSON payload in environments without an owner address.
 */
export async function sendOpsEmail(input: {
  subject: string;
  html: string;
}): Promise<OpsEmailResult> {
  const to = getOpsAlertEmail();
  if (!to) return { sent: false, reason: 'OPS_ALERT_EMAIL is not set' };
  if (!process.env.RESEND_API_KEY) {
    return { sent: false, reason: 'RESEND_API_KEY is not set' };
  }

  const { data, error } = await resend.emails.send({
    from: FROM_ADDRESS,
    to,
    subject: input.subject,
    html: input.html,
  });
  if (error) return { sent: false, reason: error.message };
  return { sent: true, to, id: data?.id ?? null };
}
