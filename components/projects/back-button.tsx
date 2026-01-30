'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

export function BackButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  const handleBackClick = (e: React.MouseEvent) => {
    e.preventDefault();
    setOpen(true);
  };

  const handleConfirmBack = () => {
    setOpen(false);
    router.push('/');
  };

  const handleCancel = () => {
    setOpen(false);
  };

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        className="h-7 has-[>svg]:px-1 flex items-center gap-1"
        onClick={handleBackClick}
      >
        <ArrowLeft className="h-3 w-3" />
        <span className="text-sm">Back</span>
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent showCloseButton={true}>
          <DialogHeader>
            <DialogTitle>Are you sure you want to go back?</DialogTitle>
            <DialogDescription>
              You will leave the editor and return to the dashboard. Any unsaved
              changes will be lost.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={handleCancel}>
              Cancel
            </Button>
            <Button onClick={handleConfirmBack}>Go back</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
