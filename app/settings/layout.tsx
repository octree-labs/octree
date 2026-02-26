import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import Navbar from '@/components/navbar';
import { SidebarNav } from '@/components/settings/sidebar-nav';
import { Settings, CreditCard } from 'lucide-react';
import { XCircle, AlertCircle } from 'lucide-react';

const sidebarNavItems = [
  {
    title: 'Account',
    href: '/settings/account',
    icon: <Settings className="h-4 w-4" />,
  },
  {
    title: 'Billing',
    href: '/settings/billing',
    icon: <CreditCard className="h-4 w-4" />,
  },
];

interface SettingsLayoutProps {
  children: React.ReactNode;
}

export default async function SettingsLayout({
  children,
}: SettingsLayoutProps) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect('/auth/login');
  }

  const userName = user?.user_metadata?.name ?? user?.email ?? null;

  return (
    <div className="flex min-h-screen flex-col bg-neutral-50/50">
      <Navbar userName={userName} />
      <main className="container mx-auto px-4 py-12 md:max-w-[800px]">
        <div className="mb-10 text-center">
          <h1 className="text-2xl font-semibold tracking-tight text-neutral-900">
            Account
          </h1>
          <p className="mt-1 text-sm text-neutral-500">
            Manage your account
          </p>
        </div>
        
        <div className="flex flex-col gap-8 lg:flex-row lg:gap-12">
          <aside className="lg:w-48 flex-shrink-0">
            <SidebarNav items={sidebarNavItems} />
          </aside>
          <div className="flex-1 min-w-0">
            {children}
          </div>
        </div>
      </main>
    </div>
  );
}
