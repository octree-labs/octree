import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { EditorSettings } from '@/components/settings/editor-settings';
import { ChangePasswordDialog } from '@/components/user/change-password-dialog';
import { EditProfileDialog } from '@/components/user/edit-profile-dialog';
import { User } from 'lucide-react';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

export default async function AccountSettingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect('/auth/login');
  }

  return (
    <div className="grid gap-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <User className="h-5 w-5" />
            Account Settings
          </CardTitle>
          <CardDescription>
            Manage your account information and preferences
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <label className="text-sm font-medium text-neutral-700">
              Email
            </label>
            <p className="text-sm text-neutral-500">{user.email}</p>
          </div>
          <div>
            <label className="text-sm font-medium text-neutral-700">
              Name
            </label>
            <p className="text-sm text-neutral-500">
              {user.user_metadata.name || 'Not set'}
            </p>
          </div>
          <div className="flex gap-2">
            <EditProfileDialog
              currentName={user.user_metadata.name || ''}
            />
            <ChangePasswordDialog />
          </div>
        </CardContent>
      </Card>
      
      <EditorSettings />
    </div>
  );
}