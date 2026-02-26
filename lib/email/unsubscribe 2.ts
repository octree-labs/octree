import { createHmac } from 'crypto';

export function generateUnsubscribeToken(email: string): string {
  return createHmac('sha256', process.env.EMAIL_UNSUBSCRIBE_SECRET!)
    .update(email.toLowerCase())
    .digest('hex');
}

export function generateUnsubscribeUrl(email: string): string {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? 'https://useoctree.online';
  const token = generateUnsubscribeToken(email);
  return `${base}/api/email/unsubscribe?email=${encodeURIComponent(email.toLowerCase())}&token=${token}`;
}
