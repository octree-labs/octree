import { BuyPageClient } from './buy-page-client';
import { isPurchasePlan } from '@/lib/checkout-plans';
import { isCheckoutOfferId, type CheckoutOfferId } from '@/lib/checkout-offers';
import type { CheckoutPlanRequest } from '@/lib/requests/subscription';

interface BuyPageProps {
  searchParams: Promise<{ plan?: string; annual?: string; offer?: string }>;
}

/**
 * Deep link from the marketing site. `?plan=monthly|annual|semester|credits_100`
 * goes straight to Checkout. The legacy `?annual=true|false` links predate
 * the plan parameter: `true` was the monthly plan and `false` the retired
 * weekly plan, so both now land on the picker with monthly preselected.
 * Without a parameter the picker is shown.
 *
 * `?offer=welcome50` (the warm_lead_offer email) shows the discount banner
 * and passes the offer to checkout for the subscription plans. An unknown
 * offer id is ignored and the page behaves as without it.
 */
export default async function BuyPage({ searchParams }: BuyPageProps) {
  const params = await searchParams;
  const plan: CheckoutPlanRequest | null = isPurchasePlan(params.plan) ? params.plan : null;
  const offer: CheckoutOfferId | null = isCheckoutOfferId(params.offer) ? params.offer : null;

  return <BuyPageClient plan={plan} offer={offer} />;
}
