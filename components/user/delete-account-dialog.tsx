'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { deleteAccount } from '@/actions/delete-account';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';

export function DeleteAccountDialog() {
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const handleDelete = async () => {
    setIsDeleting(true);
    try {
      const result = await deleteAccount();
      if (result?.success === false) {
        toast.error(result.message || 'Failed to delete account');
      } else if (result?.success === true) {
        toast.success('Account successfully deleted');
        router.push('/');
      }
    } catch (error) {
      toast.error('An unexpected error occurred while deleting your account.');
    } finally {
      setIsDeleting(false);
      setIsOpen(false);
    }
  };

  return (
    <div>
      <h3 className="text-lg font-bold tracking-tight text-red-900">
        Danger Zone
      </h3>
      <p className="mt-1 text-sm text-neutral-500">
        Permanently delete your account and all associated projects.
      </p>

      <div className="mt-6 space-y-3">
        <p className="text-sm text-neutral-500">
          This action is practically immediate, and cannot be undone. Please proceed with caution.
        </p>
        <Dialog open={isOpen} onOpenChange={setIsOpen}>
          <DialogTrigger asChild>
            <Button
              variant="destructive"
              size="sm"
            >
              Delete Account
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Are you absolutely sure?</DialogTitle>
              <DialogDescription>
                This action cannot be undone. This will permanently delete your
                account and remove your data from our servers.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter className="mt-4">
              <Button
                variant="outline"
                onClick={() => setIsOpen(false)}
                disabled={isDeleting}
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={handleDelete}
                disabled={isDeleting}
              >
                {isDeleting ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Deleting...
                  </>
                ) : (
                  'Delete Permanently'
                )}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}
