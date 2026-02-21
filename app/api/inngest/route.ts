import { serve } from 'inngest/next';
import { inngest } from '@/lib/inngest/client';
import { welcomeEmailFunction } from '@/lib/inngest/functions/welcome';
import { signInEmailFunction } from '@/lib/inngest/functions/sign-in';
import { trialStartedEmailFunction } from '@/lib/inngest/functions/trial';

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [welcomeEmailFunction, signInEmailFunction, trialStartedEmailFunction],
});
