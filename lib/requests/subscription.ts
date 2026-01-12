import { createClient } from '@/lib/supabase/client';

interface CreateCheckoutSessionOptions {
  annual?: boolean;
  withTrial?: boolean;
}

export const createCheckoutSession = async ({
  annual = false,
  withTrial = false,
}: CreateCheckoutSessionOptions = {}): Promise<string> => {
  const supabase = createClient();

  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session?.user) {
    throw new Error('User not authenticated');
  }

  const response = await fetch('/api/checkout-session', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ annual, withTrial }),
  });

  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(errorData.error || 'Failed to create checkout session');
  }

  const checkoutUrl = await response.text();
  return checkoutUrl;
};
