import { getCurrentUser } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { EditorSettings } from '@/components/settings/editor-settings';
import { SettingsCard, SettingsRow } from '@/components/settings/settings-card';
import { ChangePasswordDialog } from '@/components/user/change-password-dialog';
import { EditProfileDialog } from '@/components/user/edit-profile-dialog';
import { DeleteAccountDialog } from '@/components/user/delete-account-dialog';

export default async function AccountSettingsPage() {
  const user = await getCurrentUser();

  if (!user) {
    redirect('/auth/login');
  }

  return (
    <div className="space-y-6">
      <SettingsCard
        title="Profile"
        description="Manage your account information."
        action={
          <>
            <ChangePasswordDialog />
            <EditProfileDialog currentName={user.user_metadata.name || ''} />
          </>
        }
      >
        <SettingsRow label="Email">{user.email}</SettingsRow>
        <SettingsRow label="Name">
          {user.user_metadata.name || (
            <span className="italic text-neutral-400">Add your name</span>
          )}
        </SettingsRow>
      </SettingsCard>

      <SettingsCard title="Editor" description="Customize how the LaTeX editor looks.">
        <SettingsRow label="Theme" description="Saved automatically.">
          <EditorSettings />
        </SettingsRow>
      </SettingsCard>

      <SettingsCard
        title="Danger zone"
        description="Permanently delete your account and all of its projects. This cannot be undone."
        action={<DeleteAccountDialog />}
        className="border-red-200"
      />
    </div>
  );
}
