import { createClient } from '@supabase/supabase-js';
import { inngest } from '../client';
import { sendReEngagementEmail } from '@/lib/email/service';

function createServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

export const reEngagementEmailFunction = inngest.createFunction(
  { id: 'send-re-engagement-email' },
  { event: 'user/confirmed' },
  async ({ event, step }) => {
    await step.sleep('wait-one-week', '7d');

    const shouldSend = await step.run('check-activity', async () => {
      const supabase = createServiceClient();

      const {
        data: { user },
      } = await supabase.auth.admin.getUserById(event.data.userId);
      if (!user) {
        return false;
      }

      const sixDaysAgo = new Date(Date.now() - 6 * 24 * 60 * 60 * 1000);
      if (user.last_sign_in_at && new Date(user.last_sign_in_at) > sixDaysAgo) {
        return false;
      }

      const { data: usage } = await supabase
        .from('user_usage')
        .select('subscription_status')
        .eq('user_id', event.data.userId)
        .maybeSingle();

      if (
        usage?.subscription_status === 'active' ||
        usage?.subscription_status === 'trialing'
      ) {
        return false;
      }

      return true;
    });

    if (shouldSend) {
      await step.run('send-email', () =>
        sendReEngagementEmail(event.data.email)
      );
    }
  }
);
