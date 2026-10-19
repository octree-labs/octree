import { createHmac, timingSafeEqual } from 'crypto';

/**
 * Resend webhooks (app/api/webhooks/resend) are signed the Svix way: the
 * `svix-id`, `svix-timestamp` and `svix-signature` headers, a secret of the
 * form `whsec_<base64>`, and HMAC-SHA256 over `${id}.${timestamp}.${body}`.
 * This file is the pure half (verification and payload parsing) so it is
 * unit-tested without Next, Supabase or the network. The `svix` package is
 * not a dependency, so the check is implemented here.
 */

/** How far a webhook's timestamp may be from now before it is refused. */
export const SVIX_TOLERANCE_SECONDS = 5 * 60;

export interface SvixVerificationInput {
  /** The raw `RESEND_WEBHOOK_SECRET` (`whsec_...`). */
  secret: string;
  id: string | null | undefined;
  timestamp: string | null | undefined;
  signature: string | null | undefined;
  /** The raw request body, byte for byte. */
  body: string;
  /** Unix seconds; defaults to now. */
  nowSeconds?: number;
}

function decodeSecret(secret: string): Buffer | null {
  const raw = secret.startsWith('whsec_') ? secret.slice('whsec_'.length) : secret;
  if (!raw) return null;
  try {
    const key = Buffer.from(raw, 'base64');
    return key.length > 0 ? key : null;
  } catch {
    return null;
  }
}

/**
 * True when one of the `v1,<base64>` signatures in the header matches the
 * body under the secret and the timestamp is within tolerance. Every
 * comparison is constant-time; every malformed input is a plain `false`.
 */
export function verifySvixSignature(input: SvixVerificationInput): boolean {
  const { id, timestamp, signature, body } = input;
  if (!id || !timestamp || !signature) return false;

  const key = decodeSecret(input.secret);
  if (!key) return false;

  if (!/^\d+$/.test(timestamp)) return false;
  const sentAt = Number.parseInt(timestamp, 10);
  const now = input.nowSeconds ?? Math.floor(Date.now() / 1000);
  if (!Number.isFinite(sentAt) || Math.abs(now - sentAt) > SVIX_TOLERANCE_SECONDS) return false;

  const expected = createHmac('sha256', key).update(`${id}.${timestamp}.${body}`).digest();

  for (const candidate of signature.split(' ')) {
    const [version, value] = candidate.split(',');
    if (version !== 'v1' || !value) continue;
    let actual: Buffer;
    try {
      actual = Buffer.from(value, 'base64');
    } catch {
      continue;
    }
    if (actual.length === expected.length && timingSafeEqual(actual, expected)) return true;
  }
  return false;
}

export type ResendEngagementType = 'email.opened' | 'email.clicked';

export interface ResendEngagementEvent {
  type: ResendEngagementType;
  /** Resend's message id: `lifecycle_emails.resend_id`. */
  emailId: string;
  /** The clicked URL, as Resend reports it; null for an open. */
  link: string | null;
}

export type ParsedResendWebhook =
  | { kind: 'engagement'; event: ResendEngagementEvent }
  | { kind: 'ignored'; type: string }
  | { kind: 'invalid' };

/**
 * Reads the two events this endpoint acts on out of a Resend webhook body:
 * `{ type, data: { email_id, click?: { link } } }`. Anything else Resend
 * sends (delivered, bounced, complained...) is `ignored`; a body that is
 * not a Resend event is `invalid`.
 */
export function parseResendWebhook(body: string): ParsedResendWebhook {
  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch {
    return { kind: 'invalid' };
  }
  if (!json || typeof json !== 'object') return { kind: 'invalid' };
  const { type, data } = json as { type?: unknown; data?: unknown };
  if (typeof type !== 'string') return { kind: 'invalid' };
  if (type !== 'email.opened' && type !== 'email.clicked') return { kind: 'ignored', type };

  const record = data && typeof data === 'object' ? (data as Record<string, unknown>) : null;
  const emailId = record?.email_id;
  if (typeof emailId !== 'string' || !emailId) return { kind: 'invalid' };

  const click = record?.click && typeof record.click === 'object' ? (record.click as Record<string, unknown>) : null;
  const link = typeof click?.link === 'string' ? click.link : null;
  return { kind: 'engagement', event: { type, emailId, link } };
}

/**
 * `hostname + path` of a clicked link, for the `email_clicked` event: the
 * query (UTM tags, tokens) never reaches PostHog. Null for anything that is
 * not an absolute URL.
 */
export function linkForAnalytics(link: string | null): string | undefined {
  if (!link) return undefined;
  try {
    const url = new URL(link);
    return `${url.hostname}${url.pathname}`;
  } catch {
    return undefined;
  }
}
