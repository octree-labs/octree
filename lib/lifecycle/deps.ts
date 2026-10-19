/**
 * The real mailer, ledger and consent check behind `sendLifecycleEmail`,
 * shared by the daily cron (app/api/cron/lifecycle) and the Stripe webhook
 * (billing recovery sends at once). Everything is built on the service-role
 * client the caller passes in; nothing here imports `next/headers` or the
 * Stripe singleton, so the webhook route's own Stripe client stays in use.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database, Json } from '@/database.types';
import { getAppUrl, userUnsubscribeUrl } from '@/lib/email/unsubscribe';
import type { LifecycleTemplate } from '@/lib/email/lifecycle';
import { isMissingLedgerSchema, MAX_SEND_ATTEMPTS } from './load';
import { LifecycleLedgerUnavailableError, type LifecycleLedger, type LifecycleMailer, type LifecycleSendDeps } from './send';

export const TOOLS_URL = 'https://tools.useoctree.com';

type Db = SupabaseClient<Database>;

export interface LifecycleDepsOptions {
  /** HMAC secret for the one-click unsubscribe links (getUnsubscribeSecret()). */
  secret: string;
  /** PostHog capture for `lifecycle_email_sent`; fire-and-forget. */
  capture?: (userId: string, template: LifecycleTemplate) => void;
  throttleMs?: number;
}

export function createLifecycleMailer(): LifecycleMailer {
  return {
    async send(input) {
      // Loaded on the first send, not when this module is imported: the
      // Resend constructor throws without RESEND_API_KEY, and the Stripe
      // webhook route imports this file. A missing key must cost one
      // skipped email (caught and logged by the caller), never the
      // webhook's module load.
      const { resend, FROM_ADDRESS, REPLY_TO_ADDRESS } = await import('@/lib/email/client');
      const { data, error } = await resend.emails.send({
        from: FROM_ADDRESS,
        replyTo: REPLY_TO_ADDRESS,
        to: input.to,
        subject: input.subject,
        html: input.html,
        text: input.text,
        headers: input.headers,
      });
      return { id: data?.id ?? null, error: error?.message ?? null };
    },
  };
}

/**
 * The `lifecycle_emails` ledger. A missing table or column (the migration
 * is pending) surfaces as LifecycleLedgerUnavailableError so the caller can
 * tell "not sent because the ledger is not there" from a real failure.
 */
export function createLifecycleLedger(supabase: Db): LifecycleLedger {
  return {
    async claim({ userId, email, template, ref, payload }) {
      const { error } = await supabase
        .from('lifecycle_emails')
        .insert({ user_id: userId, email, template, ref, payload: (payload ?? null) as Json });
      if (!error) return true;
      if (isMissingLedgerSchema(error)) throw new LifecycleLedgerUnavailableError(error.message);
      if (error.code !== '23505') throw new Error(error.message);
      // 23505 = unique_violation: the key exists. Take it over only if its
      // send failed and attempts remain (one UPDATE in the RPC, so a
      // concurrent run cannot take the same row).
      const { data: retried, error: retryError } = await supabase.rpc('claim_lifecycle_retry', {
        p_user_id: userId,
        p_template: template,
        p_email: email,
        p_max_attempts: MAX_SEND_ATTEMPTS,
        p_ref: ref,
      });
      if (retryError) {
        // 42883 = the 5-argument RPC is not there yet.
        if (isMissingLedgerSchema(retryError) || retryError.code === '42883') {
          throw new LifecycleLedgerUnavailableError(retryError.message);
        }
        throw new Error(retryError.message);
      }
      return retried === true;
    },
    async markSent({ userId, template, ref, resendId }) {
      const { error } = await supabase
        .from('lifecycle_emails')
        .update({ resend_id: resendId })
        .eq('user_id', userId)
        .eq('template', template)
        .eq('ref', ref);
      if (error) throw new Error(error.message);
    },
    async markFailed({ userId, template, ref, error: message }) {
      const { error } = await supabase
        .from('lifecycle_emails')
        .update({ error: message.slice(0, 500) })
        .eq('user_id', userId)
        .eq('template', template)
        .eq('ref', ref);
      if (error) throw new Error(error.message);
    },
    async markSkipped({ userId, email, template, ref, reason, payload }) {
      // Closed on arrival: no resend_id, the reason in `error`, and attempts
      // at the cap, so isRetryable (lib/lifecycle/load.ts) and
      // claim_lifecycle_retry both leave it alone.
      const { error } = await supabase.from('lifecycle_emails').insert({
        user_id: userId,
        email,
        template,
        ref,
        payload: (payload ?? null) as Json,
        error: `skipped: ${reason}`.slice(0, 500),
        attempts: MAX_SEND_ATTEMPTS,
      });
      if (!error || error.code === '23505') return;
      if (isMissingLedgerSchema(error)) throw new LifecycleLedgerUnavailableError(error.message);
      throw new Error(error.message);
    },
  };
}

/**
 * Consent as of right now. A suppressed address (bounce, complaint, the
 * legacy unsubscribe) never gets anything. The marketing opt-out
 * (email_preferences) applies to everything except transactional notices.
 * A failed read is treated as "no consent" so an outage cannot leak email
 * to someone who opted out.
 */
export async function mayEmailNow(
  supabase: Db,
  { userId, email, transactional }: { userId: string; email: string; transactional?: boolean }
): Promise<boolean> {
  const suppression = await supabase.from('email_suppressions').select('email').eq('email', email).maybeSingle();
  if (suppression.error || suppression.data) return false;
  if (transactional) return true;
  const preference = await supabase
    .from('email_preferences')
    .select('marketing_opt_out')
    .eq('user_id', userId)
    .maybeSingle();
  if (preference.error) return false;
  return !preference.data?.marketing_opt_out;
}

export function createLifecycleDeps(supabase: Db, options: LifecycleDepsOptions): LifecycleSendDeps {
  return {
    mailer: createLifecycleMailer(),
    ledger: createLifecycleLedger(supabase),
    mayEmail: (candidate) => mayEmailNow(supabase, candidate),
    appUrl: getAppUrl(),
    toolsUrl: TOOLS_URL,
    unsubscribeUrl: (userId) => userUnsubscribeUrl(userId, options.secret),
    capture: options.capture,
    throttleMs: options.throttleMs,
  };
}
