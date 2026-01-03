import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import Navbar from '@/components/navbar';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { SubscriptionStatus } from '@/components/subscription/subscription-status';
import { BillingSection } from '@/components/subscription/billing-section';
import { EditProfileDialog } from '@/components/user/edit-profile-dialog';
import { ChangePasswordDialog } from '@/components/user/change-password-dialog';
import { EditorSettings } from '@/components/settings/editor-settings';
import { User, XCircle } from 'lucide-react';

interface SettingsPageProps {
  searchParams: Promise<{ canceled?: string }>;
}

export default async function SettingsPage({
  searchParams,
}: SettingsPageProps) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect('/auth/login');
  }

  const { canceled } = await searchParams;
  const userName = user?.user_metadata?.name ?? user?.email ?? null;

  return (
    <>
      <Navbar userName={userName} />
      <main className="container mx-auto px-4 py-8">
        <div className="mb-8">
          <h1 className="text-xl font-semibold text-neutral-900">Settings</h1>
          <p className="text-sm text-neutral-500">
            Manage your account and preferences
          </p>
        </div>
        {canceled && (
          <div className="mb-6 flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
            <XCircle className="h-4 w-4" />
            <p>Your checkout was canceled. No charges were made.</p>
          </div>
        )}
        <div className="grid gap-6 md:grid-cols-2">
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
          <SubscriptionStatus />
          <BillingSection />
        </div>
      </main>
    </>
  );
}
