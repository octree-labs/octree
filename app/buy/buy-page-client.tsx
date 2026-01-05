'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';

interface BuyPageClientProps {
  isAnnual: boolean;
}

export function BuyPageClient({ isAnnual }: BuyPageClientProps) {
  const router = useRouter();

  useEffect(() => {
    const handleCheckout = async () => {
      try {
        const response = await fetch('/api/checkout-session', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            annual: isAnnual,
          }),
        });

        if (!response.ok) {
          throw new Error('Failed to create checkout session');
        }

        const checkoutUrl = await response.text();
        window.location.href = checkoutUrl;
      } catch (error) {
        console.error('Checkout error:', error);
        router.push('/settings?error=checkout_failed');
      }
    };

    handleCheckout();
  }, [router, isAnnual]);

  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="flex items-center gap-2">
        <Loader2 className="h-6 w-6 animate-spin" />
        <p className="text-muted-foreground">Redirecting to checkout...</p>
      </div>
    </div>
  );
}
