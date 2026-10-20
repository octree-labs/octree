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
  CreateProjectForm,
  ImportProjectForm,
} from '@/components/projects/create-project-forms';

interface CreateProjectDialogProps {
  /**
   * `create` (default): the "New Project" trigger and a blank-project form.
   * `import`: an "Import" trigger and a ZIP upload, so bringing an existing
   * document is a first-class dashboard action.
   */
  mode?: 'create' | 'import';
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
              : 'Start a blank LaTeX project.'}
          </DialogDescription>
        </DialogHeader>

        {mode === 'import' ? (
          <ImportProjectForm onSuccess={handleSuccess} />
        ) : (
          <CreateProjectForm onSuccess={handleSuccess} />
        )}
      </DialogContent>
    </Dialog>
  );
}
