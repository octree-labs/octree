import { create } from 'zustand';
import type { ProFeature } from '@/lib/subscription/features';
import {
  AnalyticsEvents,
  paywallReasonForFeature,
  type PaywallOffer,
  type PaywallReason,
} from '@/lib/analytics/events';
import { track } from '@/lib/analytics/track';

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
    if (!wasOpen) track(AnalyticsEvents.PAYWALL_SHOWN, { feature, reason, offers });
  },
  close() {
    const { open, feature } = usePaywallStore.getState();
    usePaywallStore.setState({ open: false });
    if (open && feature) track(AnalyticsEvents.PAYWALL_DISMISSED, { feature });
  },
};
