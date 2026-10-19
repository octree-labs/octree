/**
 * Sending one lifecycle email: re-check consent, claim the ledger row,
 * render, deliver through Resend with the one-click unsubscribe headers,
 * record the outcome, report the analytics event. Everything external is
 * injected so the flow is testable and the cron route stays a thin wiring
 * layer.
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

/**
 * Thrown by a ledger whose table or columns are not there yet (the migration
 * has not been applied). Callers that must never fail, the Stripe webhook,
 * catch it and skip the email; the cron reports it.
 */
export class LifecycleLedgerUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LifecycleLedgerUnavailableError';
  }
}

export interface LifecycleLedgerKey {
  userId: string;
  template: LifecycleTemplate;
  /** '' for the scheduled templates; the Stripe object id for billing recovery. */
  ref: string;
}

export interface LifecycleLedger {
  /**
   * Inserts the (user, template, ref) row before the send, or takes over a
   * row whose earlier send failed and still has attempts left. Returns false
   * when the key is already claimed, i.e. another run got there first.
   */
  claim(row: LifecycleLedgerKey & { email: string; payload?: Record<string, unknown> }): Promise<boolean>;
  /** Stores the Resend message id on the claimed row. */
  markSent(row: LifecycleLedgerKey & { resendId: string }): Promise<void>;
  /** Stores the Resend error on the claimed row; the row stays claimed. */
  markFailed(row: LifecycleLedgerKey & { error: string }): Promise<void>;
  /**
   * Records that the (user, template, ref) email will never go out: a
   * follow-up whose subject is settled (the subscription recovered or
   * ended, the user subscribed). The row is closed with no attempts left,
   * so neither the retry claim nor the follow-up selection ever looks at
   * the key again. A no-op when the key already exists.
   */
  markSkipped(row: LifecycleLedgerKey & { email: string; reason: string; payload?: Record<string, unknown> }): Promise<void>;
}

export interface LifecycleSendDeps {
  mailer: LifecycleMailer;
  ledger: LifecycleLedger;
  /**
   * Consent as of right now, not as of the start of the run: false when the
   * address is suppressed or the user has opted out since the rows were
   * loaded. Checked before the claim so a refusal leaves no ledger row.
   */
  mayEmail: (candidate: { userId: string; email: string; transactional?: boolean }) => Promise<boolean>;
  /** PostHog capture, fire-and-forget. */
  capture?: (userId: string, template: LifecycleTemplate) => void;
  appUrl: string;
  toolsUrl: string;
  unsubscribeUrl: (userId: string) => string;
  /**
   * Pause between sends. Resend's default limit is 2 requests a second;
   * 600ms keeps a 200-send run under it with margin and inside the
   * route's 300s budget.
   */
  throttleMs?: number;
}

export const DEFAULT_THROTTLE_MS = 600;

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
  const ref = candidate.ref ?? '';

  if (!(await deps.mayEmail({ userId, email, transactional: candidate.transactional }))) {
    return { userId, template, sent: false, reason: 'opted out' };
  }

  // Claim the (user, template, ref) slot before sending so two overlapping
  // runs cannot both deliver. A failed send keeps the row with the error on
  // it; the next run retries it until MAX_SEND_ATTEMPTS (lib/lifecycle/load).
  const claimed = await deps.ledger.claim({ userId, email, template, ref, payload: candidate.payload });
  if (!claimed) return { userId, template, sent: false, reason: 'already sent' };

  const unsubscribeUrl = deps.unsubscribeUrl(userId);
  const templateInput = { appUrl: deps.appUrl, toolsUrl: deps.toolsUrl, unsubscribeUrl };
  const content = candidate.render ? candidate.render(templateInput) : renderLifecycleTemplate(template, templateInput);

  const { id, error } = await deps.mailer.send({
    to: email,
    subject: content.subject,
    html: content.html,
    text: content.text,
    headers: unsubscribeHeaders(unsubscribeUrl),
  });
  if (error) {
    await deps.ledger.markFailed({ userId, template, ref, error }).catch((err) => {
      console.error('[lifecycle] failed to store send error:', err);
    });
    return { userId, template, sent: false, reason: error };
  }

  if (id) {
    await deps.ledger.markSent({ userId, template, ref, resendId: id }).catch((err) => {
      console.error('[lifecycle] failed to store resend id:', err);
    });
  }
  deps.capture?.(userId, template);
  return { userId, template, sent: true, resendId: id };
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function sendLifecycleBatch(
  candidates: LifecycleCandidate[],
  deps: LifecycleSendDeps
): Promise<LifecycleSendResult[]> {
  const throttleMs = deps.throttleMs ?? DEFAULT_THROTTLE_MS;
  const results: LifecycleSendResult[] = [];
  for (const [index, candidate] of candidates.entries()) {
    if (index > 0 && throttleMs > 0) await sleep(throttleMs);
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
