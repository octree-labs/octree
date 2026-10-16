import { createClient } from '@supabase/supabase-js';
import { render } from '@react-email/render';
import { resend, FROM_ADDRESS } from './client';
import { WelcomeEmail } from './templates/welcome';
import { SignInEmail } from './templates/sign-in';

import { ReEngagementEmail } from './templates/re-engagement';
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
  const { error } = await resend.emails.send({
    from: FROM_ADDRESS,
    to: email,
    subject: 'Welcome to Octree',
    html: await render(
      WelcomeEmail({ email, unsubscribeUrl: generateUnsubscribeUrl(email) })
    ),
  });
  if (error) throw new Error(error.message);
}

export async function sendSignInEmail(email: string): Promise<void> {
  if (await isSuppressed(email)) return;
  const { error } = await resend.emails.send({
    from: FROM_ADDRESS,
    to: email,
    subject: 'New sign-in to your Octree account',
    html: await render(
      SignInEmail({ email, unsubscribeUrl: generateUnsubscribeUrl(email) })
    ),
  });
  if (error) throw new Error(error.message);
}



export async function sendReEngagementEmail(email: string): Promise<void> {
  if (await isSuppressed(email)) return;
  const { error } = await resend.emails.send({
    from: FROM_ADDRESS,
    to: email,
    subject: 'Still interested in Octree?',
    html: await render(
      ReEngagementEmail({
        email,
        unsubscribeUrl: generateUnsubscribeUrl(email),
      })
    ),
  });
  if (error) throw new Error(error.message);
}
