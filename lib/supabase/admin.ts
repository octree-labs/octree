import 'server-only';

import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/database.types';

/**
 * Service-role client. It bypasses RLS and the `user_usage` column guard
 * (supabase/migrations/20261018110000_user_usage_column_guard.sql), so it is
 * only for server code that has to write billing or quota state: the Stripe
 * webhook and the usage routes. Reads and profile writes stay on the
 * user-session client from `@/lib/supabase/server`.
 *
 * Server-only: `SUPABASE_SERVICE_ROLE_KEY` must never reach the browser.
 */
export function createAdminClient() {
  return createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    }
  );
}
