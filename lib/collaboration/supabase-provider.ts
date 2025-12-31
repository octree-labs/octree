import * as Y from 'yjs';
import { Awareness } from 'y-protocols/awareness';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/client';

export interface SupabaseProviderOptions {
  projectId: string;
  fileId: string;
  userId: string;
  userName: string;
  userColor: string;
}

export interface AwarenessState {
  user: {
    id: string;
    name: string;
    color: string;
  };
  cursor: { lineNumber: number; column: number } | null;
  selection: {
    startLineNumber: number;
    startColumn: number;
    endLineNumber: number;
    endColumn: number;
  } | null;
}

/**
 * Supabase Realtime provider for Yjs
 * Handles document sync and presence using Supabase Realtime channels
 */
export class SupabaseProvider {
  private supabase = createClient();
  private channel: RealtimeChannel | null = null;
  private doc: Y.Doc;
  private awareness: Awareness;
  private options: SupabaseProviderOptions;
  private connected = false;
  private pendingUpdates: Uint8Array[] = [];
  private remoteStates: Map<string, AwarenessState> = new Map();

  constructor(doc: Y.Doc, options: SupabaseProviderOptions) {
    this.doc = doc;
    this.options = options;
    this.awareness = new Awareness(doc);

    // Set local awareness state
    this.awareness.setLocalState({
      user: {
        id: options.userId,
        name: options.userName,
        color: options.userColor,
      },
      cursor: null,
      selection: null,
    });

    // Listen to document updates
    this.doc.on('update', this.handleDocUpdate);

    // Listen to awareness updates
    this.awareness.on('update', this.handleAwarenessUpdate);
  }

  async connect(): Promise<void> {
    const channelName = `collab:${this.options.projectId}:${this.options.fileId}`;

    this.channel = this.supabase.channel(channelName, {
      config: {
        broadcast: { self: false },
        presence: { key: this.options.userId },
      },
    });

    // Handle document sync messages
    this.channel.on('broadcast', { event: 'sync' }, ({ payload }) => {
      if (payload.userId !== this.options.userId && payload.update) {
        try {
          const update = new Uint8Array(payload.update);
          Y.applyUpdate(this.doc, update, 'remote');
        } catch (error) {
          console.error('[Collab] Error applying remote update:', error);
        }
      }
    });

    // Handle initial state sync request
    this.channel.on('broadcast', { event: 'sync-request' }, ({ payload }) => {
      if (payload.userId !== this.options.userId) {
        // Send full state to new joiner
        const state = Y.encodeStateAsUpdate(this.doc);
        this.channel?.send({
          type: 'broadcast',
          event: 'sync-response',
          payload: {
            userId: this.options.userId,
            targetUserId: payload.userId,
            state: Array.from(state),
          },
        });
      }
    });

    // Handle initial state sync response
    this.channel.on('broadcast', { event: 'sync-response' }, ({ payload }) => {
      if (payload.targetUserId === this.options.userId && payload.state) {
        try {
          const state = new Uint8Array(payload.state);
          Y.applyUpdate(this.doc, state, 'remote');
        } catch (error) {
          console.error('[Collab] Error applying sync response:', error);
        }
      }
    });

    // Handle awareness updates from others
    this.channel.on('broadcast', { event: 'awareness' }, ({ payload }) => {
      if (payload.userId !== this.options.userId && payload.state) {
        try {
          // Store remote awareness state
          this.remoteStates.set(payload.userId, payload.state as AwarenessState);
          // Notify listeners
          this.onAwarenessChange?.(this.getRemoteStates());
        } catch (error) {
          console.error('Error handling awareness:', error);
        }
      }
    });

    // Handle presence sync for showing who's online
    this.channel.on('presence', { event: 'sync' }, () => {
      const presenceState = this.channel?.presenceState();
      // Presence state contains all connected users
      this.onPresenceChange?.(presenceState || {});
    });

    this.channel.on('presence', { event: 'join' }, ({ newPresences }) => {
      this.onPresenceJoin?.(newPresences);
    });

    this.channel.on('presence', { event: 'leave' }, ({ leftPresences }) => {
      // Clean up awareness states for users who left
      for (const presence of leftPresences as { userId?: string }[]) {
        if (presence.userId) {
          this.remoteStates.delete(presence.userId);
        }
      }
      if (leftPresences.length > 0) {
        this.onAwarenessChange?.(this.getRemoteStates());
      }
      this.onPresenceLeave?.(leftPresences);
    });

    // Subscribe to channel
    await this.channel.subscribe(async (status) => {
      if (status === 'SUBSCRIBED') {
        this.connected = true;

        // Track presence
        await this.channel?.track({
          userId: this.options.userId,
          userName: this.options.userName,
          userColor: this.options.userColor,
          joinedAt: Date.now(),
        });

        // Request initial sync from others after a short delay
        setTimeout(() => {
          this.channel?.send({
            type: 'broadcast',
            event: 'sync-request',
            payload: { userId: this.options.userId },
          });
        }, 100);

        // Flush any pending updates
        this.flushPendingUpdates();
      }
    });
  }

  private handleDocUpdate = (update: Uint8Array, origin: unknown) => {
    // Don't broadcast updates that came from remote
    if (origin === 'remote') return;

    if (!this.connected || !this.channel) {
      this.pendingUpdates.push(update);
      return;
    }

    // Send updates immediately for real-time feel
    this.broadcastUpdate(update);
  };

  private broadcastUpdate(update: Uint8Array) {
    this.channel?.send({
      type: 'broadcast',
      event: 'sync',
      payload: {
        userId: this.options.userId,
        update: Array.from(update),
      },
    });
  }

  private handleAwarenessUpdate = ({ added, updated, removed }: {
    added: number[];
    updated: number[];
    removed: number[];
  }) => {
    const changedClients = [...added, ...updated, ...removed];
    
    if (changedClients.includes(this.doc.clientID)) {
      const state = this.awareness.getLocalState();
      if (state) {
        this.channel?.send({
          type: 'broadcast',
          event: 'awareness',
          payload: {
            userId: this.options.userId,
            clientId: this.doc.clientID,
            state,
          },
        });
      }
    }
  };

  private flushPendingUpdates() {
    if (this.pendingUpdates.length === 0) return;

    // Merge all pending updates
    const mergedUpdate = Y.mergeUpdates(this.pendingUpdates);
    this.pendingUpdates = [];
    this.broadcastUpdate(mergedUpdate);
  }

  // Callbacks for presence events
  onPresenceChange?: (state: Record<string, unknown[]>) => void;
  onPresenceJoin?: (presences: unknown[]) => void;
  onPresenceLeave?: (presences: unknown[]) => void;
  onAwarenessChange?: (states: Map<string, AwarenessState>) => void;

  getRemoteStates(): Map<string, AwarenessState> {
    return new Map(this.remoteStates);
  }

  removeRemoteState(userId: string): void {
    this.remoteStates.delete(userId);
    this.onAwarenessChange?.(this.getRemoteStates());
  }

  updateCursor(cursor: { lineNumber: number; column: number } | null) {
    this.awareness.setLocalStateField('cursor', cursor);
  }

  updateSelection(selection: {
    startLineNumber: number;
    startColumn: number;
    endLineNumber: number;
    endColumn: number;
  } | null) {
    this.awareness.setLocalStateField('selection', selection);
  }

  getAwareness(): Awareness {
    return this.awareness;
  }

  isConnected(): boolean {
    return this.connected;
  }

  async disconnect(): Promise<void> {
    this.doc.off('update', this.handleDocUpdate);
    this.awareness.off('update', this.handleAwarenessUpdate);

    if (this.channel) {
      await this.channel.unsubscribe();
      await this.supabase.removeChannel(this.channel);
      this.channel = null;
    }

    this.connected = false;
  }

  destroy(): void {
    this.disconnect();
    this.awareness.destroy();
  }
}

