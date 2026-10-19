import { Resend } from 'resend';

export const resend = new Resend(process.env.RESEND_API_KEY);
// useoctree.com is the fully verified Resend domain (DKIM, SPF and
// receiving). useoctree.online, the previous sender, never completed its
// receiving record, so replies to anything sent from it bounced.
export const FROM_ADDRESS = 'Basil from Octree <basil@useoctree.com>';

/**
 * Where replies to customer email land. The owner's inbox is already the
 * ops-alert recipient, so it is the default; EMAIL_REPLY_TO overrides it.
 * Undefined keeps Resend's default (replies go to the From address).
 */
export const REPLY_TO_ADDRESS: string | undefined =
  process.env.EMAIL_REPLY_TO || process.env.OPS_ALERT_EMAIL || undefined;
