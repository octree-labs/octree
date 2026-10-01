import { create } from 'zustand';

// Editor save state, shared with the project header.
interface SaveStatusState {
  isSaving: boolean;
  lastSaved: Date | null;
}

const DEFAULT_STATE: SaveStatusState = { isSaving: false, lastSaved: null };

const useSaveStatusStore = create<SaveStatusState>(() => DEFAULT_STATE);

export const useSaveStatus = () => useSaveStatusStore((state) => state);

export const SaveStatusActions = {
  setIsSaving: (isSaving: boolean) => useSaveStatusStore.setState({ isSaving }),
  setLastSaved: (lastSaved: Date | null) => useSaveStatusStore.setState({ lastSaved }),
  reset: () => useSaveStatusStore.setState(DEFAULT_STATE),
};
