'use client';

import { useEffect, useState } from 'react';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { FileText, Calendar, CreditCard, Loader2 } from 'lucide-react';

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
      month: 'long',
      day: 'numeric',
    });
  };

  const formatAmount = (amount: number, currency: string = 'usd') => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency.toUpperCase(),
    }).format(amount / 100);
  };

  const getCardBrandIcon = (brand: string) => {
    switch (brand.toLowerCase()) {
      case 'visa':
        return 'V';
      case 'mastercard':
        return 'M';
      case 'amex':
        return 'A';
      case 'discover':
        return 'D';
      default:
        return '•';
    }
  };

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CreditCard className="h-5 w-5" />
            Billing & Invoices
          </CardTitle>
          <CardDescription>
            View your billing activity and payment methods
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex h-32 items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-neutral-400" />
          </div>
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CreditCard className="h-5 w-5" />
            Billing & Invoices
          </CardTitle>
          <CardDescription>
            View your billing activity and payment methods
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="text-center text-sm text-red-600">Error: {error}</div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <CreditCard className="h-5 w-5" />
          Billing & Invoices
        </CardTitle>
        <CardDescription>
          View your billing activity and payment methods
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Billing Summary */}
        <div>
          <h3 className="mb-3 text-sm font-medium text-neutral-700">
            <Calendar className="mb-1 inline h-4 w-4" /> Billing Summary
          </h3>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="rounded-lg border p-3">
              <p className="text-xs text-neutral-500">Total Paid</p>
              <p className="text-lg font-bold text-neutral-900">
                {formatAmount(billingData?.billingSummary.totalPaid || 0)}
              </p>
            </div>
            <div className="rounded-lg border p-3">
              <p className="text-xs text-neutral-500">Invoices</p>
              <p className="text-lg font-bold text-neutral-900">
                {billingData?.billingSummary.invoiceCount || 0}
              </p>
            </div>
            <div className="rounded-lg border p-3">
              <p className="text-xs text-neutral-500">Next Billing</p>
              <p className="text-sm font-bold text-neutral-900">
                {billingData?.billingSummary.nextBilling
                  ? formatDate(billingData.billingSummary.nextBilling)
                  : 'No subscription'}
              </p>
            </div>
          </div>
        </div>

        {/* Recent Invoices */}
        <div>
          <h3 className="mb-3 text-sm font-medium text-neutral-700">
            <FileText className="mb-1 inline h-4 w-4" /> Recent Invoices
          </h3>
          {billingData?.invoices && billingData.invoices.length > 0 ? (
            <div className="space-y-2">
              {billingData.invoices.slice(0, 3).map((invoice) => (
                <div
                  key={invoice.id}
                  className="flex items-center justify-between rounded-lg border p-3"
                >
                  <div>
                    <p className="text-sm font-medium text-neutral-900">
                      {invoice.description}
                    </p>
                    <p className="text-xs text-neutral-500">
                      {formatDate(invoice.date)}
                    </p>
                  </div>
                  <p className="text-sm font-medium text-neutral-900">
                    {formatAmount(invoice.amount, invoice.currency)}
                  </p>
                </div>
              ))}
              {billingData.invoices.length > 3 && (
                <Button variant="outline" size="sm" className="w-full">
                  View All Invoices
                </Button>
              )}
            </div>
          ) : (
            <div className="rounded-lg border p-4 text-center text-sm text-neutral-500">
              No invoices found
            </div>
          )}
        </div>

        {/* Payment Methods */}
        <div>
          <h3 className="mb-3 text-sm font-medium text-neutral-700">
            <CreditCard className="mb-1 inline h-4 w-4" /> Payment Methods
          </h3>
          {billingData?.paymentMethods &&
          billingData.paymentMethods.length > 0 ? (
            <div className="space-y-2">
              {billingData.paymentMethods.map((pm) => (
                <div
                  key={pm.id}
                  className="flex items-center justify-between rounded-lg border p-3"
                >
                  <div className="flex items-center gap-3">
                    <div className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-100">
                      <span className="text-sm font-medium text-blue-600">
                        {pm.card ? getCardBrandIcon(pm.card.brand) : '•'}
                      </span>
                    </div>
                    <div>
                      <p className="text-sm font-medium text-neutral-900">
                        {pm.card
                          ? `${pm.card.brand} ending in ${pm.card.last4}`
                          : 'Payment method'}
                      </p>
                      {pm.card && (
                        <p className="text-xs text-neutral-500">
                          Expires {pm.card.expMonth}/{pm.card.expYear}
                        </p>
                      )}
                    </div>
                  </div>
                  <Button variant="outline" size="sm">
                    Update
                  </Button>
                </div>
              ))}
            </div>
          ) : (
            <div className="rounded-lg border p-4 text-center text-sm text-neutral-500">
              No payment methods found
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
