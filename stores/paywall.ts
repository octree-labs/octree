import { create } from 'zustand';
import type { ProFeature } from '@/lib/subscription/features';
import {
  AnalyticsEvents,
  paywallReasonForFeature,
  type PaywallOffer,
  type PaywallReason,
} from '@/lib/analytics/events';
import { track } from '@/lib/analytics/track';
import { recordPaywallHit } from '@/lib/requests/paywall';
import type { CheckoutOfferId } from '@/lib/checkout-offers';

interface PaywallState {
  open: boolean;
  /** Which gate opened the dialog; drives its title and description. */
  feature: ProFeature | null;
  /**
   * Why; `monthly_limit` (a Pro user out of edits) offers credits only,
   * `generate_quota` means the free generation is spent.
   */
  reason: PaywallReason | null;
  /** What the dialog sells. `['pro']` is the plain upgrade dialog. */
  offers: PaywallOffer[];
  /**
   * The first-purchase offer from the last GET /api/subscription-status
   * (hooks/use-subscription-usage.ts sets it); null until loaded or when
   * the user is not eligible. The dialog shows it on the Pro offer.
   */
  firstPurchaseOffer: CheckoutOfferId | null;
  /**
   * What the gate was about, for offers tied to it: the export paywall's
   * one-off "Export this document" needs the project to unlock. Reset on
   * every open; null when the opener passed none.
   */
  context: PaywallContext | null;
}

export interface PaywallContext {
  /** The project an `export_single` purchase would unlock. */
  projectId?: string;
}

const DEFAULT_OFFERS: PaywallOffer[] = ['pro'];

export const usePaywallStore = create<PaywallState>(() => ({
  open: false,
  feature: null,
  reason: null,
  offers: DEFAULT_OFFERS,
  firstPurchaseOffer: null,
  context: null,
}));

/**
 * The offer the dialog shows for a paywall: the first-purchase offer on
 * every Pro paywall, never on `monthly_limit` (a Pro user; credits only).
 */
export function paywallOfferFor(
  reason: PaywallReason | null,
  firstPurchaseOffer: CheckoutOfferId | null
): CheckoutOfferId | null {
  return reason === 'monthly_limit' ? null : firstPurchaseOffer;
}

export const usePaywall = () => usePaywallStore();

export const PaywallActions = {
  open(
    feature: ProFeature,
    reason: PaywallReason = paywallReasonForFeature(feature),
    offers: PaywallOffer[] = DEFAULT_OFFERS,
    context?: PaywallContext
  ) {
    const { open: wasOpen, firstPurchaseOffer } = usePaywallStore.getState();
    usePaywallStore.setState({ open: true, feature, reason, offers, context: context ?? null });
    if (!wasOpen) {
      const offer = paywallOfferFor(reason, firstPurchaseOffer);
      track(AnalyticsEvents.PAYWALL_SHOWN, { feature, reason, offers, ...(offer ? { offer } : {}) });
      // Server-side record for the warm_lead_offer email; skips monthly_limit
      // and never throws.
      void recordPaywallHit(feature, reason);
    }
  },
  setFirstPurchaseOffer(firstPurchaseOffer: CheckoutOfferId | null) {
    if (usePaywallStore.getState().firstPurchaseOffer !== firstPurchaseOffer) {
      usePaywallStore.setState({ firstPurchaseOffer });
    }
  },
  close() {
    const { open, feature, reason } = usePaywallStore.getState();
    usePaywallStore.setState({ open: false });
    // `reason` lets a dismissal be read against the paywall that showed it
    // (generate_quota vs daily_limit vs pro_feature) without a per-user join.
    if (open && feature) track(AnalyticsEvents.PAYWALL_DISMISSED, { feature, reason: reason ?? undefined });
  },
};
