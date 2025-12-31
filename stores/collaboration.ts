import { create } from 'zustand';
import type { CollaboratorPresence } from '@/types/collaboration';

interface CollaborationState {
  isConnected: boolean;
  collaborators: CollaboratorPresence[];
  setConnected: (connected: boolean) => void;
  setCollaborators: (collaborators: CollaboratorPresence[]) => void;
  addCollaborator: (collaborator: CollaboratorPresence) => void;
  removeCollaborator: (userId: string) => void;
  updateCollaborator: (userId: string, updates: Partial<CollaboratorPresence>) => void;
  reset: () => void;
}

const DEFAULT_STATE = {
  isConnected: false,
  collaborators: [],
};

export const useCollaborationStore = create<CollaborationState>((set, get) => ({
  ...DEFAULT_STATE,

  setConnected: (connected) => set({ isConnected: connected }),

  setCollaborators: (collaborators) => set({ collaborators }),

  addCollaborator: (collaborator) => {
    const existing = get().collaborators.find((c) => c.user_id === collaborator.user_id);
    if (!existing) {
      set((state) => ({
        collaborators: [...state.collaborators, collaborator],
      }));
    }
  },

  removeCollaborator: (userId) => {
    set((state) => ({
      collaborators: state.collaborators.filter((c) => c.user_id !== userId),
    }));
  },

  updateCollaborator: (userId, updates) => {
    set((state) => ({
      collaborators: state.collaborators.map((c) =>
        c.user_id === userId ? { ...c, ...updates } : c
      ),
    }));
  },

  reset: () => set(DEFAULT_STATE),
}));

export const useIsCollaborating = () =>
  useCollaborationStore((state) => state.isConnected);

export const useCollaborators = () =>
  useCollaborationStore((state) => state.collaborators);

export const CollaborationActions = {
  setConnected: (connected: boolean) =>
    useCollaborationStore.getState().setConnected(connected),
  setCollaborators: (collaborators: CollaboratorPresence[]) =>
    useCollaborationStore.getState().setCollaborators(collaborators),
  addCollaborator: (collaborator: CollaboratorPresence) =>
    useCollaborationStore.getState().addCollaborator(collaborator),
  removeCollaborator: (userId: string) =>
    useCollaborationStore.getState().removeCollaborator(userId),
  updateCollaborator: (userId: string, updates: Partial<CollaboratorPresence>) =>
    useCollaborationStore.getState().updateCollaborator(userId, updates),
  updateCollaboratorCursor: (
    userId: string,
    cursor: { lineNumber: number; column: number } | null
  ) => useCollaborationStore.getState().updateCollaborator(userId, { cursor: cursor ?? undefined }),
  updateCollaboratorSelection: (
    userId: string,
    selection: {
      startLineNumber: number;
      startColumn: number;
      endLineNumber: number;
      endColumn: number;
    } | null
  ) => useCollaborationStore.getState().updateCollaborator(userId, { selection: selection ?? undefined }),
  reset: () => useCollaborationStore.getState().reset(),
};

