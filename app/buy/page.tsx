import { BuyPageClient } from './buy-page-client';
import { isPurchasePlan } from '@/lib/checkout-plans';
import type { CheckoutPlanRequest } from '@/lib/requests/subscription';

interface BuyPageProps {
  searchParams: Promise<{ plan?: string; annual?: string }>;
}

/**
 * Deep link from the marketing site. `?plan=monthly|annual|semester|credits_100`
 * goes straight to Checkout. The legacy `?annual=true|false` links predate
 * the plan parameter: `true` was the monthly plan and `false` the retired
 * weekly plan, so both now land on the picker with monthly preselected.
 * Without a parameter the picker is shown.
 */
export default async function BuyPage({ searchParams }: BuyPageProps) {
  const params = await searchParams;
  const plan: CheckoutPlanRequest | null = isPurchasePlan(params.plan) ? params.plan : null;

  return <BuyPageClient plan={plan} />;
}
