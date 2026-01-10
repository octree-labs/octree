'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { FilePlus2, Sparkles } from 'lucide-react';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { CreateProjectTabs } from '@/components/projects/create-project-tabs';
import { ActionCard } from '@/components/ui/action-card';

export function DashboardActions() {
    const [dialogOpen, setDialogOpen] = useState(false);
    const router = useRouter();

    const handleProjectCreated = (projectId: string) => {
        setDialogOpen(false);
        router.push(`/projects/${projectId}`);
    };

    return (
        <>
            <div className="grid gap-4 sm:grid-cols-2">
                <ActionCard
                    icon={<FilePlus2 className="h-5 w-5" />}
                    title="New Project"
                    description="Create a blank LaTeX document or import from a ZIP file."
                    onClick={() => setDialogOpen(true)}
                    variant="blue"
                />
                <Link href="/generate" className="block">
                    <ActionCard
                        icon={<Sparkles className="h-5 w-5" />}
                        title="Generate with AI"
                        description="Use AI to generate a complete research paper from your topic."
                        variant="rose"
                        className="h-full"
                    />
                </Link>
            </div>

            <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
                <DialogContent className="sm:max-w-[500px]">
                    <DialogHeader>
                        <DialogTitle>New Project</DialogTitle>
                        <DialogDescription>
                            Create a new project or import from a ZIP file.
                        </DialogDescription>
                    </DialogHeader>
                    <CreateProjectTabs onSuccess={handleProjectCreated} />
                </DialogContent>
            </Dialog>
        </>
    );
}
