import type React from 'react';
import {
    SidebarProvider,
} from '@/components/ui/sidebar';

export default async function GenerateLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    return (
        <SidebarProvider defaultOpen={true}>
            {children}
        </SidebarProvider>
    );
}
