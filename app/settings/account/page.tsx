import { getCurrentUser } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { EditorSettings } from '@/components/settings/editor-settings';
import { SettingsCard, SettingsRow } from '@/components/settings/settings-card';
import { ChangePasswordDialog } from '@/components/user/change-password-dialog';
import { EditProfileDialog } from '@/components/user/edit-profile-dialog';
import { DeleteAccountDialog } from '@/components/user/delete-account-dialog';
import { ApiKeysSection } from '@/components/settings/api-keys-section';
import { listApiKeys } from '@/actions/api-keys';
import { MAX_ACTIVE_API_KEYS } from '@/lib/api/keys';

export default async function AccountSettingsPage() {
  const user = await getCurrentUser();

  if (!user) {
    redirect('/auth/login');
  }

  const apiKeys = await listApiKeys();

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

      <ApiKeysSection initialKeys={apiKeys} maxKeys={MAX_ACTIVE_API_KEYS} />

      <SettingsCard
        title="Danger zone"
        description="Permanently delete your account and all of its projects. This cannot be undone."
        action={<DeleteAccountDialog />}
        className="border-red-200"
      />
    </div>
  );
}
