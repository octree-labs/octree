import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { EditorSettings } from '@/components/settings/editor-settings';
import { ChangePasswordDialog } from '@/components/user/change-password-dialog';
import { EditProfileDialog } from '@/components/user/edit-profile-dialog';
import { DeleteAccountDialog } from '@/components/user/delete-account-dialog';

export default async function AccountSettingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect('/auth/login');
  }

  return (
    <div>
      {/* Account section */}
      <div className="mb-10">
        <h2 className="text-2xl font-bold tracking-tight text-neutral-900">
          Account
        </h2>
        <p className="mt-1 text-sm text-neutral-500">
          Manage your account information and preferences
        </p>
      </div>

      <div className="space-y-5">
        <div className="rounded-xl border border-neutral-300 px-4 pb-3 pt-2">
          <label className="text-xs font-medium text-neutral-500">
            Email
          </label>
          <p className="text-[15px] text-neutral-900">{user.email}</p>
        </div>
        <div className="rounded-xl border border-neutral-300 px-4 pb-3 pt-2">
          <label className="text-xs font-medium text-neutral-500">
            Name
          </label>
          {user.user_metadata.name ? (
            <p className="text-[15px] text-neutral-900">
              {user.user_metadata.name}
            </p>
          ) : (
            <p className="text-[15px] italic text-neutral-400">
              Add your name
            </p>
          )}
        </div>
        <div className="flex gap-3">
          <EditProfileDialog
            currentName={user.user_metadata.name || ''}
          />
          <ChangePasswordDialog />
        </div>
      </div>

      <hr className="my-10 border-neutral-200" />

      {/* Editor settings section */}
      <EditorSettings />

      <hr className="my-10 border-neutral-200" />

      {/* Danger zone */}
      <DeleteAccountDialog />
    </div>
  );
}
