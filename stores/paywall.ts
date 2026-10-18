import { create } from 'zustand';
import type { ProFeature } from '@/lib/subscription/features';
import {
  AnalyticsEvents,
  paywallReasonForFeature,
  type PaywallReason,
} from '@/lib/analytics/events';
import { track } from '@/lib/analytics/track';

interface PaywallState {
  open: boolean;
  /** Which gate opened the dialog; drives its title and description. */
  feature: ProFeature | null;
  /** Why; `monthly_limit` (a Pro user out of edits) offers credits only. */
  reason: PaywallReason | null;
}

export const usePaywallStore = create<PaywallState>(() => ({
  open: false,
  feature: null,
  reason: null,
}));

export const usePaywall = () => usePaywallStore();

export const PaywallActions = {
  open(feature: ProFeature, reason: PaywallReason = paywallReasonForFeature(feature)) {
    const wasOpen = usePaywallStore.getState().open;
    usePaywallStore.setState({ open: true, feature, reason });
    if (!wasOpen) track(AnalyticsEvents.PAYWALL_SHOWN, { feature, reason });
  },
  close() {
    const { open, feature } = usePaywallStore.getState();
    usePaywallStore.setState({ open: false });
    if (open && feature) track(AnalyticsEvents.PAYWALL_DISMISSED, { feature });
  },
};
