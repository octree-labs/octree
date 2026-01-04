'use client';

import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { CreditCard, Lock, CheckCircle } from 'lucide-react';
import { FREE_DAILY_EDIT_LIMIT, PRO_MONTHLY_EDIT_LIMIT } from '@/data/constants';

type PaywallVariant = 'edit-limit' | 'export';

interface PaywallDialogProps {
  isOpen: boolean;
  onClose: () => void;
  editCount?: number;
  remainingEdits?: number;
  isMonthly?: boolean;
  variant?: PaywallVariant;
}

export function PaywallDialog({
  isOpen,
  onClose,
  editCount = 0,
  remainingEdits = 0,
  isMonthly = false,
  variant = 'edit-limit',
}: PaywallDialogProps) {
  const [isLoading, setIsLoading] = useState(false);

  const handleSubscribe = async () => {
    setIsLoading(true);
    try {
      const response = await fetch('/api/checkout-session', {
        method: 'POST',
      });

      if (response.ok) {
        const checkoutUrl = await response.text();
        window.location.href = checkoutUrl;
      } else {
        console.error('Failed to create checkout session');
      }
    } catch (error) {
      console.error('Error creating checkout session:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const features = [
    `${PRO_MONTHLY_EDIT_LIMIT} AI-powered edits per month`,
    'Advanced LaTeX compilation',
    'Priority support',
    'Export to multiple formats',
  ];

  // Variant-specific content
  const isExportVariant = variant === 'export';
  
  const title = isExportVariant 
    ? 'Subscribe to Export'
    : isMonthly 
      ? 'Monthly Limit Reached' 
      : 'Daily Limit Reached';

  const description = isExportVariant
    ? 'Exporting documents is a Pro feature. Subscribe to download your work as PDF or ZIP.'
    : isMonthly
      ? `You've used ${editCount} out of ${PRO_MONTHLY_EDIT_LIMIT} monthly AI edits. Upgrade to Pro for more!`
      : `You've used ${editCount} out of ${FREE_DAILY_EDIT_LIMIT} daily AI edits. Upgrade to Pro for ${PRO_MONTHLY_EDIT_LIMIT} edits per month!`;

  const maxEdits = isMonthly ? PRO_MONTHLY_EDIT_LIMIT : FREE_DAILY_EDIT_LIMIT;

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="mb-2 flex items-center gap-2">
            <Lock className="h-6 w-6 text-amber-500" />
            <DialogTitle className="text-xl">{title}</DialogTitle>
          </div>
          <DialogDescription className="text-base">
            {description}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          {!isExportVariant && (
            <div className="rounded-lg bg-neutral-50 p-4">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-sm font-medium text-neutral-700">
                  Your Usage
                </span>
                <Badge variant="secondary">
                  {editCount}/{maxEdits} edits used
                </Badge>
              </div>
              <div className="h-2 w-full rounded-full bg-neutral-200">
                <div
                  className="h-2 rounded-full bg-amber-500 transition-all duration-300"
                  style={{ width: `${(editCount / maxEdits) * 100}%` }}
                />
              </div>
              <p className="mt-2 text-xs text-neutral-500">
                {remainingEdits > 0
                  ? `${remainingEdits} edits remaining`
                  : 'No edits remaining'}
              </p>
            </div>
          )}

          <div className="space-y-3">
            <h3 className="flex items-center gap-2 font-semibold text-neutral-900">
              Pro Features
            </h3>
            <ul className="space-y-2">
              {features.map((feature, index) => (
                <li
                  key={index}
                  className="flex items-center gap-2 text-sm text-neutral-700"
                >
                  <CheckCircle className="h-4 w-4 flex-shrink-0 text-blue-500" />
                  {feature}
                </li>
              ))}
            </ul>
          </div>

          <div className="space-y-3">
            <Button
              onClick={handleSubscribe}
              disabled={isLoading}
              className="w-full bg-gradient-to-b from-primary-light to-primary text-white hover:from-primary-light/90 hover:to-primary/90"
              size="lg"
            >
              {isLoading ? (
                <div className="flex items-center gap-2">
                  <div className="h-4 w-4 animate-spin rounded-full border-b-2 border-white" />
                  Redirecting...
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <CreditCard className="h-4 w-4" />
                  Subscribe Now
                </div>
              )}
            </Button>

            <Button variant="outline" onClick={onClose} className="w-full">
              Maybe Later
            </Button>
          </div>

          <p className="text-center text-xs text-neutral-500">
            {isExportVariant
              ? 'Subscribe to unlock exports and all Pro features.'
              : 'You can continue using the editor, but this feature requires a Pro subscription.'}
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
