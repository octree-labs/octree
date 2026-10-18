/**
 * Sending one lifecycle email: render, deliver through Resend with the
 * one-click unsubscribe headers, record the (user, template) row, report the
 * analytics event. Everything external is injected so the flow is testable
 * and the cron route stays a thin wiring layer.
 */
import { renderLifecycleTemplate, type LifecycleTemplate } from '@/lib/email/lifecycle';
import type { LifecycleCandidate } from './select';

export interface LifecycleMailer {
  send(input: {
    to: string;
    subject: string;
    html: string;
    text: string;
    headers: Record<string, string>;
  }): Promise<{ id: string | null; error: string | null }>;
}

export interface LifecycleLedger {
  /**
   * Inserts the (user, template) row before the send. Returns false when the
   * unique key already exists, i.e. another run got there first.
   */
  claim(row: { userId: string; email: string; template: LifecycleTemplate }): Promise<boolean>;
  /** Stores the Resend message id on the claimed row. */
  markSent(row: { userId: string; template: LifecycleTemplate; resendId: string }): Promise<void>;
}

export interface LifecycleSendDeps {
  mailer: LifecycleMailer;
  ledger: LifecycleLedger;
  /** PostHog capture, fire-and-forget. */
  capture?: (userId: string, template: LifecycleTemplate) => void;
  appUrl: string;
  toolsUrl: string;
  unsubscribeUrl: (userId: string) => string;
}

export type LifecycleSendResult =
  | { userId: string; template: LifecycleTemplate; sent: true; resendId: string | null }
  | { userId: string; template: LifecycleTemplate; sent: false; reason: string };

export function unsubscribeHeaders(unsubscribeUrl: string): Record<string, string> {
  return {
    'List-Unsubscribe': `<${unsubscribeUrl}>`,
    'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
  };
}

export async function sendLifecycleEmail(
  candidate: LifecycleCandidate,
  deps: LifecycleSendDeps
): Promise<LifecycleSendResult> {
  const { userId, template, email } = candidate;
  const unsubscribeUrl = deps.unsubscribeUrl(userId);

  // Claim the (user, template) slot before sending so two overlapping runs
  // cannot both deliver. A failed send leaves the row in place with no
  // resend_id; the owner can clear those rows to retry.
  const claimed = await deps.ledger.claim({ userId, email, template });
  if (!claimed) return { userId, template, sent: false, reason: 'already sent' };

  const content = renderLifecycleTemplate(template, {
    appUrl: deps.appUrl,
    toolsUrl: deps.toolsUrl,
    unsubscribeUrl,
  });

  const { id, error } = await deps.mailer.send({
    to: email,
    subject: content.subject,
    html: content.html,
    text: content.text,
    headers: unsubscribeHeaders(unsubscribeUrl),
  });
  if (error) return { userId, template, sent: false, reason: error };

  if (id) {
    await deps.ledger.markSent({ userId, template, resendId: id }).catch((err) => {
      console.error('[lifecycle] failed to store resend id:', err);
    });
  }
  deps.capture?.(userId, template);
  return { userId, template, sent: true, resendId: id };
}

export async function sendLifecycleBatch(
  candidates: LifecycleCandidate[],
  deps: LifecycleSendDeps
): Promise<LifecycleSendResult[]> {
  const results: LifecycleSendResult[] = [];
  for (const candidate of candidates) {
    try {
      results.push(await sendLifecycleEmail(candidate, deps));
    } catch (error) {
      results.push({
        userId: candidate.userId,
        template: candidate.template,
        sent: false,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return results;
}
