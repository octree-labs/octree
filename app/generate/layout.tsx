import type React from 'react';
import { SidebarProvider } from '@/components/ui/sidebar';
import { getCurrentUser, getUserUsageStatus } from '@/actions/get-user';
import { PaywallDialog } from '@/components/subscription/paywall-dialog';

export default async function GenerateLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    const user = await getCurrentUser();
    const usage = user ? await getUserUsageStatus(user.id) : null;
    const showPaywall = usage?.onboarding_completed && !usage?.is_pro;

    return (
        <SidebarProvider defaultOpen={true}>
            {showPaywall && user?.email && <PaywallDialog userEmail={user.email} />}
            {children}
        </SidebarProvider>
    );
}
