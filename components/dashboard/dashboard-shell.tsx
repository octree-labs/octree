'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { ChevronDown, FolderOpen, HelpCircle, LogOut, Menu, Settings } from 'lucide-react';
import { OctreeLogo, OctreeWordmark } from '@/components/icons/octree-logo';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarSeparator,
  useSidebar,
} from '@/components/ui/sidebar';
import { createClient } from '@/lib/supabase/client';
import { resetAnalytics } from '@/lib/analytics/track';

const NAV_ITEMS = [{ href: '/', label: 'Projects', icon: FolderOpen }];

// `match` is the path prefix that marks the item active. Settings links
// straight to its first tab so the click skips the /settings redirect.
const ACCOUNT_ITEMS = [
  { href: '/settings/account', match: '/settings', label: 'Settings', icon: Settings },
  { href: '/help', match: '/help', label: 'Help', icon: HelpCircle },
];

function DashboardSidebar({ userName }: { userName: string | null }) {
  const pathname = usePathname();
  const router = useRouter();
  const { isMobile, setOpenMobile } = useSidebar();

  const displayName = userName || 'User';

  const closeOnMobile = () => {
    if (isMobile) setOpenMobile(false);
  };

  const handleLogout = async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    resetAnalytics();
    router.push('/auth/login');
  };

  return (
    <Sidebar>
      <SidebarHeader className="h-14 flex-row items-center px-4">
        <Link href="/" onClick={closeOnMobile} className="flex items-center gap-2">
          <OctreeLogo className="h-7 w-7" />
          <OctreeWordmark className="text-lg" />
        </Link>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup className="px-2 pt-4">
          <SidebarGroupContent>
            <SidebarMenu>
              {NAV_ITEMS.map(({ href, label, icon: Icon }) => (
                <SidebarMenuItem key={href}>
                  <SidebarMenuButton asChild isActive={pathname === href}>
                    <Link href={href} onClick={closeOnMobile}>
                      <Icon />
                      <span>{label}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter>
        <SidebarMenu>
          {ACCOUNT_ITEMS.map(({ href, match, label, icon: Icon }) => (
            <SidebarMenuItem key={href}>
              <SidebarMenuButton asChild isActive={pathname.startsWith(match)}>
                <Link href={href} onClick={closeOnMobile}>
                  <Icon />
                  <span>{label}</span>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          ))}
        </SidebarMenu>
        <SidebarSeparator className="mx-0" />
        <SidebarMenu>
          <SidebarMenuItem>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <SidebarMenuButton className="h-10 data-[state=open]:bg-sidebar-accent">
                  <span className="min-w-0 flex-1 truncate font-medium text-neutral-900">
                    {displayName}
                  </span>
                  <ChevronDown className="ml-auto" />
                </SidebarMenuButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                side="top"
                align="start"
                className="w-[var(--radix-dropdown-menu-trigger-width)] min-w-56"
              >
                <DropdownMenuLabel className="truncate font-normal text-neutral-500">
                  {displayName}
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={handleLogout}>
                  <LogOut className="mr-2 h-4 w-4" />
                  Log out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}

function MobileHeader() {
  const { toggleSidebar } = useSidebar();

  return (
    <header className="flex h-14 shrink-0 items-center gap-2 border-b border-gray-200 px-4 md:hidden">
      <button
        type="button"
        onClick={toggleSidebar}
        aria-label="Open menu"
        className="-ml-1.5 rounded-md p-1.5 transition-colors hover:bg-gray-100"
      >
        <Menu className="size-5 text-neutral-700" />
      </button>
      <Link href="/" className="flex items-center gap-2">
        <OctreeLogo className="h-6 w-6" />
        <OctreeWordmark className="text-base" />
      </Link>
    </header>
  );
}

export function DashboardShell({
  userName,
  children,
}: {
  userName: string | null;
  children: React.ReactNode;
}) {
  // Always expanded on desktop: there is no top bar to put a toggle back in,
  // so the ⌘K shortcut must not be able to hide it. Mobile uses the sheet.
  return (
    <SidebarProvider open onOpenChange={() => {}}>
      <DashboardSidebar userName={userName} />
      {/* Exactly one screen tall: the dashboard scrolls inside it, so the
          projects pagination can stay pinned to the bottom. */}
      <SidebarInset className="h-svh overflow-hidden">
        <MobileHeader />
        {children}
      </SidebarInset>
    </SidebarProvider>
  );
}
