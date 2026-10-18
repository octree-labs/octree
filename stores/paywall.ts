import { create } from 'zustand';
import type { ProFeature } from '@/lib/subscription/features';

interface PaywallState {
  open: boolean;
  /** Which gate opened the dialog; drives its title and description. */
  feature: ProFeature | null;
}

export const usePaywallStore = create<PaywallState>(() => ({
  open: false,
  feature: null,
}));

export const usePaywall = () => usePaywallStore();

export const PaywallActions = {
  open(feature: ProFeature) {
    usePaywallStore.setState({ open: true, feature });
  },
  close() {
    usePaywallStore.setState({ open: false });
  },
};
