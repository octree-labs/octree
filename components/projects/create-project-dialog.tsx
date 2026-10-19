'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { PlusIcon, Upload } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  CreateProjectTabs,
  type CreateProjectTab,
} from '@/components/projects/create-project-tabs';

interface CreateProjectDialogProps {
  /**
   * `create` (default): the "New Project" trigger, opening on the blank tab.
   * `import`: an "Import" trigger opening straight on the ZIP tab, so
   * bringing an existing document is a first-class dashboard action.
   */
  mode?: CreateProjectTab;
}

export function CreateProjectDialog({ mode = 'create' }: CreateProjectDialogProps) {
  const [open, setOpen] = useState(false);
  const router = useRouter();

  const handleSuccess = (projectId: string) => {
    setOpen(false);
    router.push(`/projects/${projectId}`);
  };

  const handleOpenChange = (newOpen: boolean) => {
    setOpen(newOpen);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        {mode === 'import' ? (
          <Button size="sm" variant="outline">
            <Upload />
            Import
          </Button>
        ) : (
          <Button size="sm" variant="gradient">
            <PlusIcon />
            New Project
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>{mode === 'import' ? 'Import project' : 'New Project'}</DialogTitle>
          <DialogDescription>
            {mode === 'import'
              ? 'Upload a ZIP of your LaTeX project, for example an Overleaf export.'
              : 'Create a new project or import from a ZIP file.'}
          </DialogDescription>
        </DialogHeader>

        <CreateProjectTabs onSuccess={handleSuccess} defaultTab={mode} />
      </DialogContent>
    </Dialog>
  );
}
