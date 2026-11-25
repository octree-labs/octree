import type React from 'react';
import { SidebarProvider, SidebarInset } from '@/components/ui/sidebar';
import { PaywallDialog } from '@/components/subscription/paywall-dialog';
import { GenerateHistorySidebar } from '@/components/generate/GenerateHistorySidebar';
import { getCurrentUser } from '@/actions/get-user';
import { enforceOnboardingPaywall } from '@/lib/onboarding/paywall-gate-server';

export default async function GenerateLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    // Onboarding paywall: a new, non-Pro user goes to /onboarding first.
    const user = await getCurrentUser();
    if (user) await enforceOnboardingPaywall(user, '/generate');

    return (
        <SidebarProvider defaultOpen={true}>
            <GenerateHistorySidebar />
            {/* Free users can browse; generating opens this (stores/paywall.ts) */}
            <PaywallDialog />
            <SidebarInset className="flex h-screen flex-col overflow-hidden">
                {children}
            </SidebarInset>
        </SidebarProvider>
    );
}
