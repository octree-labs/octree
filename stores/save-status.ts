import { create } from 'zustand';

// Editor save state, shared with the project header.
interface SaveStatusState {
  isSaving: boolean;
  lastSaved: Date | null;
  // Edits not yet saved (waiting on the autosave, or the save failed).
  hasUnsavedChanges: boolean;
}

const DEFAULT_STATE: SaveStatusState = {
  isSaving: false,
  lastSaved: null,
  hasUnsavedChanges: false,
};

const useSaveStatusStore = create<SaveStatusState>(() => DEFAULT_STATE);

export const useSaveStatus = () => useSaveStatusStore((state) => state);

export const SaveStatusActions = {
  setIsSaving: (isSaving: boolean) => useSaveStatusStore.setState({ isSaving }),
  setLastSaved: (lastSaved: Date | null) => useSaveStatusStore.setState({ lastSaved }),
  setHasUnsavedChanges: (hasUnsavedChanges: boolean) =>
    useSaveStatusStore.setState({ hasUnsavedChanges }),
  hasUnsavedChanges: () => useSaveStatusStore.getState().hasUnsavedChanges,
  reset: () => useSaveStatusStore.setState(DEFAULT_STATE),
};
