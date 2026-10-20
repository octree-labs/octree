import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/supabase/server';
import { DashboardShell } from '@/components/dashboard/dashboard-shell';
import { SettingsTabs } from '@/components/settings/settings-tabs';

const settingsTabs = [
  { title: 'Account', href: '/settings/account' },
  { title: 'Billing', href: '/settings/billing' },
];

interface SettingsLayoutProps {
  children: React.ReactNode;
}

export default async function SettingsLayout({
  children,
}: SettingsLayoutProps) {
  const user = await getCurrentUser();

  if (!user) {
    redirect('/auth/login');
  }

  const userName = user?.user_metadata?.name ?? user?.email ?? null;

  return (
    <DashboardShell userName={userName}>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-4xl px-4 py-8 md:px-8">
          <h1 className="text-2xl font-semibold tracking-tight text-neutral-900">
            Settings
          </h1>
          <div className="mt-6">
            <SettingsTabs items={settingsTabs} />
          </div>
          <div className="mt-8">{children}</div>
        </div>
      </div>
    </DashboardShell>
  );
}
