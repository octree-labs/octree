import type React from 'react';
import { SidebarProvider, SidebarInset } from '@/components/ui/sidebar';
import { getCurrentUser, getUserUsageStatus } from '@/actions/get-user';
import { PaywallDialog } from '@/components/subscription/paywall-dialog';
import { GenerateHistorySidebar } from '@/components/generate/GenerateHistorySidebar';

export default async function GenerateLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    const user = await getCurrentUser();
    // TEMPORARILY DISABLED - allowing users to enter without paywall
    // const usage = user ? await getUserUsageStatus(user.id) : null;
    // const showPaywall = usage?.onboarding_completed && !usage?.is_pro;

    return (
        <SidebarProvider defaultOpen={true}>
            <GenerateHistorySidebar />
            {/* {showPaywall && user?.email && <PaywallDialog userEmail={user.email} />} */}
            <SidebarInset className="flex h-screen flex-col overflow-hidden">
                {children}
            </SidebarInset>
        </SidebarProvider>
    );
}
