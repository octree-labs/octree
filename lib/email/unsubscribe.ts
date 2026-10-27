import { createHmac, timingSafeEqual } from 'crypto';

/**
 * Two unsubscribe token formats coexist:
 *
 *  - legacy (transactional emails in lib/email/service.ts):
 *    `?email=<addr>&token=<hmac(email)>`
 *  - lifecycle (lib/lifecycle, app/api/cron/lifecycle):
 *    `?token=<base64url(userId)>.<hmac(userId)>`, which carries no address
 *    so the link itself leaks nothing about the recipient.
 *
 * Both are HMAC-SHA256 under EMAIL_UNSUBSCRIBE_SECRET, falling back to
 * CRON_SECRET so a deployment with only the cron configured still produces
 * working links. The pure helpers take the secret as an
 * argument so they can be unit-tested without touching the environment.
 */

const APP_URL_FALLBACK = 'https://app.useoctree.com';

export function getAppUrl(): string {
  return (process.env.NEXT_PUBLIC_APP_URL ?? APP_URL_FALLBACK).replace(/\/$/, '');
}

export function getUnsubscribeSecret(): string | null {
  const secret = process.env.EMAIL_UNSUBSCRIBE_SECRET?.trim() || process.env.CRON_SECRET?.trim();
  return secret ? secret : null;
}

// --- Legacy email-based token -------------------------------------------------

export function generateUnsubscribeToken(email: string): string {
  const secret = getUnsubscribeSecret();
  if (!secret) throw new Error('EMAIL_UNSUBSCRIBE_SECRET (or CRON_SECRET) is not set');
  return createHmac('sha256', secret)
    .update(email.toLowerCase())
    .digest('hex');
}

export function generateUnsubscribeUrl(email: string): string {
  const token = generateUnsubscribeToken(email);
  return `${getAppUrl()}/api/email/unsubscribe?email=${encodeURIComponent(email.toLowerCase())}&token=${token}`;
}

// --- Lifecycle user-id token -------------------------------------------------

function sign(userId: string, secret: string): string {
  return createHmac('sha256', secret).update(`unsubscribe:${userId}`).digest('base64url');
}

/** `base64url(userId).hmac` — opaque, URL-safe, carries no email address. */
export function createUserUnsubscribeToken(userId: string, secret: string): string {
  return `${Buffer.from(userId, 'utf8').toString('base64url')}.${sign(userId, secret)}`;
}

/** Returns the user id when the token is well-formed and the signature matches. */
export function verifyUserUnsubscribeToken(token: string, secret: string): string | null {
  const dot = token.indexOf('.');
  if (dot <= 0 || dot === token.length - 1) return null;
  let userId: string;
  try {
    userId = Buffer.from(token.slice(0, dot), 'base64url').toString('utf8');
  } catch {
    return null;
  }
  if (!userId) return null;
  const expected = Buffer.from(sign(userId, secret));
  const actual = Buffer.from(token.slice(dot + 1));
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
  return userId;
}

export function userUnsubscribeUrl(userId: string, secret: string, appUrl = getAppUrl()): string {
  return `${appUrl}/api/email/unsubscribe?token=${encodeURIComponent(createUserUnsubscribeToken(userId, secret))}`;
}
