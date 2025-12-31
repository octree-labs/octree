'use client';

import { useEffect, useRef, useCallback, useState } from 'react';
import * as Y from 'yjs';
import { SupabaseProvider } from '@/lib/collaboration/supabase-provider';
import { CollaborationActions, useCollaborators } from '@/stores/collaboration';
import { getUserColor, type CollaboratorPresence } from '@/types/collaboration';
import { createClient } from '@/lib/supabase/client';

interface UseCollaborationOptions {
  projectId: string;
  fileId: string;
  enabled?: boolean;
}

interface UseCollaborationReturn {
  ydoc: Y.Doc | null;
  provider: SupabaseProvider | null;
  isConnected: boolean;
  collaborators: CollaboratorPresence[];
  updateCursor: (cursor: { lineNumber: number; column: number } | null) => void;
  updateSelection: (selection: {
    startLineNumber: number;
    startColumn: number;
    endLineNumber: number;
    endColumn: number;
  } | null) => void;
}

export function useCollaboration({
  projectId,
  fileId,
  enabled = true,
}: UseCollaborationOptions): UseCollaborationReturn {
  const ydocRef = useRef<Y.Doc | null>(null);
  const providerRef = useRef<SupabaseProvider | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const collaborators = useCollaborators();

  useEffect(() => {
    if (!enabled || !projectId || !fileId) {
      return;
    }

    let mounted = true;

    const initCollaboration = async () => {
      const supabase = createClient();
      const { data: { session } } = await supabase.auth.getSession();

      if (!session?.user || !mounted) return;

      const userId = session.user.id;
      const userName = session.user.user_metadata?.name || session.user.email || 'Anonymous';
      const userColor = getUserColor(userId);

      // Create Yjs document
      const ydoc = new Y.Doc();
      ydocRef.current = ydoc;

      // Create and connect provider
      const provider = new SupabaseProvider(ydoc, {
        projectId,
        fileId,
        userId,
        userName,
        userColor,
      });

      providerRef.current = provider;

      // Handle presence changes
      provider.onPresenceChange = (state) => {
        const collaboratorList: CollaboratorPresence[] = [];

        Object.entries(state).forEach(([key, presences]) => {
          (presences as unknown[]).forEach((presence: unknown) => {
            const p = presence as {
              userId: string;
              userName: string;
              userColor: string;
              joinedAt: number;
            };

            if (p.userId !== userId) {
              collaboratorList.push({
                id: p.userId,
                user_id: p.userId,
                name: p.userName,
                email: '',
                color: p.userColor,
                lastActive: p.joinedAt,
              });
            }
          });
        });

        CollaborationActions.setCollaborators(collaboratorList);
      };

      provider.onPresenceJoin = (presences) => {
        (presences as unknown[]).forEach((presence: unknown) => {
          const p = presence as {
            userId: string;
            userName: string;
            userColor: string;
            joinedAt: number;
          };

          if (p.userId !== userId) {
            CollaborationActions.addCollaborator({
              id: p.userId,
              user_id: p.userId,
              name: p.userName,
              email: '',
              color: p.userColor,
              lastActive: p.joinedAt,
            });
          }
        });
      };

      provider.onPresenceLeave = (presences) => {
        (presences as unknown[]).forEach((presence: unknown) => {
          const p = presence as { userId: string };
          CollaborationActions.removeCollaborator(p.userId);
        });
      };

      // Handle awareness changes (cursor/selection updates)
      provider.onAwarenessChange = (states) => {
        states.forEach((state, odId) => {
          CollaborationActions.updateCollaboratorCursor(odId, state.cursor);
          CollaborationActions.updateCollaboratorSelection(odId, state.selection);
        });
      };

      try {
        await provider.connect();
        if (mounted) {
          setIsConnected(true);
          CollaborationActions.setConnected(true);
        }
      } catch (error) {
        console.error('Failed to connect collaboration:', error);
      }
    };

    initCollaboration();

    return () => {
      mounted = false;
      if (providerRef.current) {
        providerRef.current.destroy();
        providerRef.current = null;
      }
      if (ydocRef.current) {
        ydocRef.current.destroy();
        ydocRef.current = null;
      }
      setIsConnected(false);
      CollaborationActions.reset();
    };
  }, [projectId, fileId, enabled]);

  const updateCursor = useCallback(
    (cursor: { lineNumber: number; column: number } | null) => {
      providerRef.current?.updateCursor(cursor);
    },
    []
  );

  const updateSelection = useCallback(
    (selection: {
      startLineNumber: number;
      startColumn: number;
      endLineNumber: number;
      endColumn: number;
    } | null) => {
      providerRef.current?.updateSelection(selection);
    },
    []
  );

  return {
    ydoc: ydocRef.current,
    provider: providerRef.current,
    isConnected,
    collaborators,
    updateCursor,
    updateSelection,
  };
}

