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
  private syncTimeout: NodeJS.Timeout | null = null;

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
      console.log('[Collab] Received sync update from:', payload.userId);
      if (payload.userId !== this.options.userId && payload.update) {
        try {
          const update = new Uint8Array(payload.update);
          Y.applyUpdate(this.doc, update, 'remote');
          console.log('[Collab] Applied remote update, doc length:', this.doc.getText('content').toString().length);
        } catch (error) {
          console.error('[Collab] Error applying remote update:', error);
        }
      }
    });

    // Handle initial state sync request
    this.channel.on('broadcast', { event: 'sync-request' }, ({ payload }) => {
      console.log('[Collab] Received sync request from:', payload.userId);
      if (payload.userId !== this.options.userId) {
        // Send full state to new joiner
        const state = Y.encodeStateAsUpdate(this.doc);
        const docContent = this.doc.getText('content').toString();
        console.log('[Collab] Sending sync response, doc length:', docContent.length);
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
      console.log('[Collab] Received sync response for:', payload.targetUserId, 'from:', payload.userId);
      if (payload.targetUserId === this.options.userId && payload.state) {
        try {
          const state = new Uint8Array(payload.state);
          Y.applyUpdate(this.doc, state, 'remote');
          console.log('[Collab] Applied sync response, doc length:', this.doc.getText('content').toString().length);
        } catch (error) {
          console.error('[Collab] Error applying sync response:', error);
        }
      }
    });

    // Handle awareness updates from others
    this.channel.on('broadcast', { event: 'awareness' }, ({ payload }) => {
      if (payload.userId !== this.options.userId && payload.state) {
        try {
          // Update awareness for this user
          const states = new Map();
          states.set(parseInt(payload.clientId) || 0, payload.state);
          // We'll handle this differently - store in a separate map
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
      this.onPresenceLeave?.(leftPresences);
    });

    // Subscribe to channel
    await this.channel.subscribe(async (status) => {
      console.log('[Collab] Channel status:', status);
      if (status === 'SUBSCRIBED') {
        this.connected = true;
        console.log('[Collab] Connected to channel:', channelName);

        // Track presence
        await this.channel?.track({
          userId: this.options.userId,
          userName: this.options.userName,
          userColor: this.options.userColor,
          joinedAt: Date.now(),
        });

        // Request initial sync from others after a short delay
        // This gives time for the initial content to be loaded
        setTimeout(() => {
          console.log('[Collab] Sending sync request');
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

    // Debounce updates to reduce message frequency
    if (this.syncTimeout) {
      clearTimeout(this.syncTimeout);
    }

    this.syncTimeout = setTimeout(() => {
      this.broadcastUpdate(update);
    }, 50);
  };

  private broadcastUpdate(update: Uint8Array) {
    console.log('[Collab] Broadcasting update, size:', update.length);
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
    if (this.syncTimeout) {
      clearTimeout(this.syncTimeout);
    }

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

