import { serve } from 'inngest/next';
import { inngest } from '@/lib/inngest/client';
import { welcomeEmailFunction } from '@/lib/inngest/functions/welcome';
import { signInEmailFunction } from '@/lib/inngest/functions/sign-in';

// The day-7 re-engagement email moved to the lifecycle cron
// (app/api/cron/lifecycle, template `day7`), which dedupes through the
// `lifecycle_emails` ledger. Registering the old Inngest function too would
// send two day-7 emails to the same person.
export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [welcomeEmailFunction, signInEmailFunction],
});
