import { inngest } from '../client';
import { sendTrialStartedEmail } from '@/lib/email/service';

export const trialStartedEmailFunction = inngest.createFunction(
  { id: 'send-trial-started-email' },
  { event: 'subscription/trial-started' },
  async ({ event }) => {
    await sendTrialStartedEmail(event.data.email, new Date(event.data.trialEndsAt));
  }
);
