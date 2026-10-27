import { createClient } from '@supabase/supabase-js';
import { resend, FROM_ADDRESS, REPLY_TO_ADDRESS } from './client';
import { signInAlertEmail, signupWelcomeEmail } from './templates/account';

import { generateUnsubscribeUrl } from './unsubscribe';

function createServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

async function isSuppressed(email: string): Promise<boolean> {
  try {
    const supabase = createServiceClient();
    const { data } = await supabase
      .from('email_suppressions')
      .select('email')
      .eq('email', email.toLowerCase())
      .maybeSingle();
    return !!data;
  } catch {
    return false;
  }
}

export async function sendWelcomeEmail(email: string): Promise<void> {
  if (await isSuppressed(email)) return;
  const { subject, html, text } = signupWelcomeEmail({ email, unsubscribeUrl: generateUnsubscribeUrl(email) });
  const { error } = await resend.emails.send({
    from: FROM_ADDRESS,
    replyTo: REPLY_TO_ADDRESS,
    to: email,
    subject,
    html,
    text,
  });
  if (error) throw new Error(error.message);
}

export async function sendSignInEmail(email: string): Promise<void> {
  if (await isSuppressed(email)) return;
  const { subject, html, text } = signInAlertEmail({ email, unsubscribeUrl: generateUnsubscribeUrl(email) });
  const { error } = await resend.emails.send({
    from: FROM_ADDRESS,
    replyTo: REPLY_TO_ADDRESS,
    to: email,
    subject,
    html,
    text,
  });
  if (error) throw new Error(error.message);
}
