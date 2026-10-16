import { inngest } from '../client';
import { sendSignInEmail } from '@/lib/email/service';

export const signInEmailFunction = inngest.createFunction(
  { id: 'send-sign-in-email' },
  { event: 'user/signed-in' },
  async ({ event }) => {
    await sendSignInEmail(event.data.email);
  }
);
