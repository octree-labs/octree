'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { SaveStatusActions } from '@/stores/save-status';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

function pushHistoryState() {
  const url = window.location.pathname + window.location.search;
  window.history.pushState({ backConfirm: true }, '', url);
}

export function BackButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    pushHistoryState();

    const handlePopState = () => {
      if (!SaveStatusActions.hasUnsavedChanges()) {
        // Nothing to lose: step past the guard entry and really go back.
        window.history.back();
        return;
      }
      setOpen(true);
      pushHistoryState();
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  const goBack = () => {
    router.push('/');
    router.refresh();
  };

  const handleBackClick = (e: React.MouseEvent) => {
    e.preventDefault();
    if (SaveStatusActions.hasUnsavedChanges()) {
      setOpen(true);
    } else {
      goBack();
    }
  };

  const handleConfirmBack = () => {
    setOpen(false);
    goBack();
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
            <DialogTitle>You have unsaved changes</DialogTitle>
            <DialogDescription>
              If you go back to the dashboard now, your unsaved changes will be
              lost.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={handleCancel}
              className="bg-white"
            >
              Cancel
            </Button>
            <Button onClick={handleConfirmBack} variant="gradient">Go back</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
