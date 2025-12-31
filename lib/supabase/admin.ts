import { createClient } from '@supabase/supabase-js';

// Admin client with service role for server-side admin operations
export function createAdminClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

  if (!serviceRoleKey) {
    console.error('SUPABASE_SERVICE_ROLE_KEY is not configured!');
    throw new Error('SUPABASE_SERVICE_ROLE_KEY is required for admin operations');
  }

  console.log('Creating admin client with service role key (first 10 chars):', serviceRoleKey.substring(0, 10) + '...');

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

