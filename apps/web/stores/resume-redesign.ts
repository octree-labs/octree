import { create } from 'zustand';
import type { RedesignResultEvent } from '@/types/resume';

// Hands a finished redesign from the dashboard dialog to the /resume review page.
export type PendingRedesign = {
  fileName: string;
  storagePath: string;
  result: RedesignResultEvent;
};

const useResumeRedesignStore = create<{ pending: PendingRedesign | null }>(() => ({
  pending: null,
}));

export const usePendingRedesign = () =>
  useResumeRedesignStore((state) => state.pending);

export const ResumeRedesignActions = {
  get: () => useResumeRedesignStore.getState().pending,
  set: (pending: PendingRedesign) => useResumeRedesignStore.setState({ pending }),
  clear: () => useResumeRedesignStore.setState({ pending: null }),
};
