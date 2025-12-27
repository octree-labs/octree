import { redirect } from 'next/navigation';

import { createClient } from '@/lib/supabase/server';
import { isAdminEmail } from '@/lib/admin';
import { AdminDashboard } from '@/components/admin/admin-dashboard';

export const dynamic = 'force-dynamic';

export default async function AdminPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user || !isAdminEmail(user.email)) {
    redirect('/');
  }

  return <AdminDashboard />;
}

