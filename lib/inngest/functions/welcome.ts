import { inngest } from '../client';
import { sendWelcomeEmail } from '@/lib/email/service';

export const welcomeEmailFunction = inngest.createFunction(
  { id: 'send-welcome-email' },
  { event: 'user/confirmed' },
  async ({ event }) => {
    await sendWelcomeEmail(event.data.email);
  }
);
