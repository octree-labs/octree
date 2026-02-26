import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import Navbar from '@/components/navbar';
import { SidebarNav } from '@/components/settings/sidebar-nav';
import { User, CreditCard } from 'lucide-react';

const sidebarNavItems = [
  {
    title: 'Account',
    href: '/settings/account',
    icon: <User className="h-4 w-4" />,
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
    <div className="flex min-h-screen flex-col bg-white">
      <Navbar userName={userName} />
      <main className="flex flex-1 flex-col px-6 py-10 lg:flex-row lg:px-16 lg:py-12">
        <aside className="mb-8 flex-shrink-0 lg:mb-0 lg:mt-4 lg:w-52 lg:pr-12">
          <SidebarNav items={sidebarNavItems} />
        </aside>
        <div className="flex-1 min-w-0 max-w-2xl">
          {children}
        </div>
      </main>
    </div>
  );
}
