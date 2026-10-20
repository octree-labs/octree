'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { SettingsCard, SettingsRow } from '@/components/settings/settings-card';
import { SettingsCardSkeleton } from '@/components/settings/settings-card-skeleton';

interface BillingSummary {
  totalPaid: number;
  invoiceCount: number;
  nextBilling: number | null;
}

interface Invoice {
  id: string;
  date: number;
  amount: number;
  status: string;
  description: string;
  currency: string;
}

interface PaymentMethod {
  id: string;
  type: string;
  card: {
    brand: string;
    last4: string;
    expMonth: number;
    expYear: number;
  } | null;
}

export function BillingSection() {
  const [billingData, setBillingData] = useState<{
    billingSummary: BillingSummary;
    invoices: Invoice[];
    paymentMethods: PaymentMethod[];
  } | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isPortalLoading, setIsPortalLoading] = useState(false);

  useEffect(() => {
    const fetchBillingData = async () => {
      try {
        const response = await fetch('/api/billing');
        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.error || 'Failed to fetch billing data');
        }

        setBillingData(data);
      } catch (error) {
        setError(error instanceof Error ? error.message : 'An error occurred');
      } finally {
        setIsLoading(false);
      }
    };

    fetchBillingData();
  }, []);

  const formatDate = (timestamp: number) => {
    return new Date(timestamp * 1000).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };

  const formatAmount = (amount: number, currency: string = 'usd') => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency.toUpperCase(),
    }).format(amount / 100);
  };

  const openBillingPortal = async () => {
    setIsPortalLoading(true);
    try {
      const response = await fetch('/api/billing-portal', { method: 'POST' });
      const data = await response.json();
      if (!response.ok || !data.url) {
        throw new Error(data.error || 'Could not open the billing portal');
      }
      window.location.href = data.url;
    } catch (error) {
      console.error('Error opening billing portal:', error);
      toast.error('Could not open billing. Please try again.');
      setIsPortalLoading(false);
    }
  };

  if (isLoading) {
    return <SettingsCardSkeleton rows={3} />;
  }

  if (error) {
    return <SettingsCard title="Billing" description={`Could not load billing details: ${error}`} />;
  }

  const invoices = billingData?.invoices ?? [];
  const paymentMethods = billingData?.paymentMethods ?? [];
  const nextBilling = billingData?.billingSummary.nextBilling ?? null;

  // Nothing to show for someone who has never paid.
  if (invoices.length === 0 && paymentMethods.length === 0) {
    return null;
  }

  return (
    <SettingsCard
      title="Billing"
      description="Payment method and invoices."
      action={
        <Button variant="outline" size="sm" onClick={openBillingPortal} disabled={isPortalLoading}>
          {isPortalLoading ? 'Opening...' : 'Manage billing'}
        </Button>
      }
    >
      {paymentMethods.map((pm) => (
        <SettingsRow key={pm.id} label="Payment method">
          {pm.card ? (
            <span>
              <span className="capitalize">{pm.card.brand}</span> ending in {pm.card.last4}
              <span className="text-neutral-500">
                {' '}
                · Expires {pm.card.expMonth}/{pm.card.expYear}
              </span>
            </span>
          ) : (
            'Payment method on file'
          )}
        </SettingsRow>
      ))}

      {nextBilling && (
        <SettingsRow label="Next payment">{formatDate(nextBilling)}</SettingsRow>
      )}

      {invoices.length > 0 && (
        <SettingsRow label="Invoices">
          <ul className="space-y-2">
            {invoices.slice(0, 3).map((invoice) => (
              <li key={invoice.id} className="flex items-center justify-between gap-4">
                <span className="min-w-0 truncate">
                  {formatDate(invoice.date)}
                  <span className="text-neutral-500"> · {invoice.description}</span>
                </span>
                <span className="shrink-0 tabular-nums">
                  {formatAmount(invoice.amount, invoice.currency)}
                </span>
              </li>
            ))}
          </ul>
          {invoices.length > 3 && (
            <Button
              variant="link"
              size="sm"
              className="mt-2 h-auto p-0"
              onClick={openBillingPortal}
              disabled={isPortalLoading}
            >
              View all invoices
            </Button>
          )}
        </SettingsRow>
      )}
    </SettingsCard>
  );
}
