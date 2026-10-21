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
}

const DEFAULT_OFFERS: PaywallOffer[] = ['pro'];

export const usePaywallStore = create<PaywallState>(() => ({
  open: false,
  feature: null,
  reason: null,
  offers: DEFAULT_OFFERS,
}));

export const usePaywall = () => usePaywallStore();

export const PaywallActions = {
  open(
    feature: ProFeature,
    reason: PaywallReason = paywallReasonForFeature(feature),
    offers: PaywallOffer[] = DEFAULT_OFFERS
  ) {
    const wasOpen = usePaywallStore.getState().open;
    usePaywallStore.setState({ open: true, feature, reason, offers });
    if (!wasOpen) {
      track(AnalyticsEvents.PAYWALL_SHOWN, { feature, reason, offers });
      // Server-side record for the warm_lead_offer email; skips monthly_limit
      // and never throws.
      void recordPaywallHit(feature, reason);
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
