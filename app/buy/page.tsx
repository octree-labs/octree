import { BuyPageClient } from './buy-page-client';
import { isPurchasePlan } from '@/lib/checkout-plans';
import { isCheckoutOfferId, type CheckoutOfferId } from '@/lib/checkout-offers';
import type { CheckoutPlanRequest } from '@/lib/requests/subscription';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { firstPurchaseOfferForUser } from '@/lib/first-purchase-offer-server';

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
 * and passes the offer to checkout for the plans it covers (welcome50: monthly
 * only; annual and semester check out at full price). An unknown
 * offer id is ignored and the page behaves as without it.
 *
 * Without `?offer=` a signed-in user who has never bought anything gets the
 * first-purchase offer (lib/first-purchase-offer.ts) as if the link had
 * carried `?offer=welcome50`. Decided here on the server, so the page needs
 * no status request from the browser. An explicit `?offer=` always wins.
 */
export default async function BuyPage({ searchParams }: BuyPageProps) {
  const params = await searchParams;
  const plan: CheckoutPlanRequest | null = isPurchasePlan(params.plan) ? params.plan : null;
  const offer: CheckoutOfferId | null = isCheckoutOfferId(params.offer) ? params.offer : null;
  const autoOffer = offer ? null : await autoOfferForCurrentUser();

  return <BuyPageClient plan={plan} offer={offer} autoOffer={autoOffer} />;
}

/**
 * Signed-out visitors never get here (middleware redirects them to
 * /auth/login with `next=/buy...`), but a session that lapses between the
 * middleware and the render reads as no user and no offer. Never throws:
 * the page renders as without the offer.
 */
async function autoOfferForCurrentUser(): Promise<CheckoutOfferId | null> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return null;
    return await firstPurchaseOfferForUser(supabase, createAdminClient, user);
  } catch (error) {
    console.error('[buy] first-purchase offer check failed:', error);
    return null;
  }
}
