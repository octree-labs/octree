import type React from 'react';
import { SidebarProvider, SidebarInset } from '@/components/ui/sidebar';
import { PaywallDialog } from '@/components/subscription/paywall-dialog';
import { GenerateHistorySidebar } from '@/components/generate/GenerateHistorySidebar';

export default async function GenerateLayout({
    children,
}: {
    children: React.ReactNode;
}) {
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
