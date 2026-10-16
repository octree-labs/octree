import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { SubscriptionStatus } from '@/components/subscription/subscription-status';
import { BillingSection } from '@/components/subscription/billing-section';
import { XCircle, AlertCircle } from 'lucide-react';

interface BillingSettingsPageProps {
  searchParams: Promise<{ canceled?: string; error?: string }>;
}

export default async function BillingSettingsPage({
  searchParams,
}: BillingSettingsPageProps) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect('/auth/login');
  }

  const { canceled, error } = await searchParams;

  return (
    <div>
      <div className="mb-10">
        <h2 className="text-2xl font-bold tracking-tight text-neutral-900">
          Billing
        </h2>
        <p className="mt-1 text-sm text-neutral-500">
          Manage your subscription and payment details
        </p>
      </div>

      <div className="space-y-6">
      {canceled && (
        <div className="mb-6 flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          <XCircle className="h-4 w-4" />
          <p>Your checkout was canceled. No charges were made.</p>
        </div>
      )}
      {error === 'checkout_failed' && (
        <div className="mb-6 flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          <AlertCircle className="h-4 w-4" />
          <p>
            Failed to create checkout session. Please try again or contact
            support if the issue persists.
          </p>
        </div>
      )}

      <div className="grid gap-6">
        <SubscriptionStatus />
        <BillingSection />
      </div>
      </div>
    </div>
  );
}
