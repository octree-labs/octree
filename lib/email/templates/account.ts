import { checklist, facts, p, renderLifecycleEmail, type LifecycleEmailContent } from '../lifecycle/layout';
import { getAppUrl } from '../unsubscribe';

interface AccountEmailInput {
  email: string;
  unsubscribeUrl: string;
}

/** Sent once the address is confirmed (Inngest `user/confirmed`). */
export function signupWelcomeEmail({ unsubscribeUrl }: AccountEmailInput): LifecycleEmailContent {
  return renderLifecycleEmail({
    template: 'signup_welcome',
    subject: 'Welcome to Octree',
    preheader: 'Your account is ready. Here is how to get started.',
    headline: 'Welcome aboard!',
    subheadline: 'Your account is ready.',
    blocks: [
      p('Octree brings AI assistance to LaTeX writing, letting you focus on your ideas instead of syntax.'),
      p("Here's how to get started:"),
      checklist([
        { body: p('Create your first project') },
        { body: p('Let AI generate or refine your equations') },
        { body: p('Compile directly to PDF') },
      ]),
    ],
    cta: { label: 'Open your dashboard', href: `${getAppUrl()}/` },
    closing: ['The Octree Team'],
    unsubscribeUrl,
  });
}

/** Sent on every sign-in (Inngest `user/signed-in`). */
export function signInAlertEmail({ email, unsubscribeUrl }: AccountEmailInput): LifecycleEmailContent {
  return renderLifecycleEmail({
    template: 'sign_in_alert',
    subject: 'New sign-in to your Octree account',
    preheader: `A new sign-in to ${email}.`,
    eyebrow: 'Security',
    headline: 'New sign-in detected',
    blocks: [
      p('We noticed a new sign-in to your Octree account.'),
      facts([
        ['Account', email],
        ['Time', new Date().toUTCString()],
      ]),
      p('If this was you, you can safely ignore this email.'),
      p("If you didn't sign in, please change your password immediately to secure your account."),
    ],
    cta: { label: 'Secure your account', href: `${getAppUrl()}/settings` },
    closing: ['The Octree Team'],
    footerReason: `Security notification for ${email}.`,
    unsubscribeUrl,
  });
}
