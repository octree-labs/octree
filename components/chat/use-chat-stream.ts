import { useRef, useCallback } from 'react';
import { StringEdit } from '@/lib/octra-agent/edits';
import { createClient } from '@/lib/supabase/client';

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
}

interface SelectionRange {
  startLineNumber: number;
  startColumn: number;
  endLineNumber: number;
  endColumn: number;
}

interface ProjectFileContextPayload {
  path: string;
  content: string;
}

interface ProjectContextPayload {
  currentFilePath: string | null;
  projectFiles: ProjectFileContextPayload[];
}

interface StreamCallbacks {
  onTextUpdate: (text: string) => void;
  onEdits: (edits: StringEdit[]) => void;
  onToolCall: (
    name: string,
    count?: number,
    violations?: unknown[],
    progressIncrement?: number,
    textLength?: number
  ) => void;
  onError: (error: string) => void;
  onStatus: (state: string) => void;
}

export function useChatStream() {
  const abortControllerRef = useRef<AbortController | null>(null);
  const rafIdRef = useRef<number | null>(null);
  const pendingTextRef = useRef<string>('');
  const supabaseRef = useRef(createClient());

  const startStream = useCallback(
    async (
      messages: ChatMessage[],
      fileContent: string,
      textFromEditor: string | null,
      selectionRange: SelectionRange | null | undefined,
      projectContext: ProjectContextPayload,
      callbacks: StreamCallbacks,
      sessionId?: string
    ) => {
      // Cancel existing stream
      if (abortControllerRef.current) {
        try {
          abortControllerRef.current.abort();
        } catch {}
        abortControllerRef.current = null;
      }

      // Reset pending RAF
      if (rafIdRef.current != null) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
      pendingTextRef.current = '';

      const controller = new AbortController();
      abortControllerRef.current = controller;

      const remoteUrl = process.env.NEXT_PUBLIC_CLAUDE_AGENT_SERVICE_URL;
      if (!remoteUrl) {
        return {
          response: new Response(
            JSON.stringify({ error: 'Agent service URL is not configured' }),
            {
              status: 503,
              headers: { 'Content-Type': 'application/json' },
            }
          ),
          controller,
        };
      }

      const usageRes = await fetch('/api/track-edit', {
        method: 'POST',
        signal: controller.signal,
      });

      if (!usageRes.ok) {
        return { response: usageRes, controller };
      }

      let usagePayload: {
        canEdit?: boolean;
        limitReached?: boolean;
        error?: string;
      } | null = null;
      try {
        usagePayload = await usageRes.json();
      } catch {}

      if (usagePayload?.limitReached || usagePayload?.canEdit === false) {
        return {
          response: new Response(
            JSON.stringify({
              error:
                usagePayload.error ||
                "You've reached your edit limit. Upgrade to Pro for more edits.",
              limitReached: true,
            }),
            {
              status: 429,
              headers: { 'Content-Type': 'application/json' },
            }
          ),
          controller,
        };
      }

      const {
        data: { session },
      } = await supabaseRef.current.auth.getSession();

      if (!session?.access_token) {
        return {
          response: new Response(
            JSON.stringify({ error: 'Unauthorized. Please log in to use AI features.' }),
            {
              status: 401,
              headers: { 'Content-Type': 'application/json' },
            }
          ),
          controller,
        };
      }

      const res = await fetch(remoteUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          accept: 'text/event-stream',
          authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          messages,
          fileContent,
          textFromEditor,
          selectionRange,
          projectFiles: projectContext.projectFiles,
          currentFilePath: projectContext.currentFilePath,
          sessionId,
        }),
        signal: controller.signal,
      });

      return { response: res, controller };
    },
    []
  );

  const parseStream = useCallback(
    async (
      reader: ReadableStreamDefaultReader<Uint8Array>,
      callbacks: StreamCallbacks
    ) => {
      const decoder = new TextDecoder();
      let buffer = '';
      let lastAssistantText = '';

      const cancelPendingFrame = () => {
        if (rafIdRef.current != null) {
          cancelAnimationFrame(rafIdRef.current);
          rafIdRef.current = null;
        }
      };

      const flushQueued = () => {
        if (!pendingTextRef.current) return;
        const toFlush = pendingTextRef.current;
        pendingTextRef.current = '';
        rafIdRef.current = null;
        if (!toFlush) return;
        lastAssistantText = `${lastAssistantText}${toFlush}`;
        callbacks.onTextUpdate(lastAssistantText);
      };

      const queueChunk = (chunk: string) => {
        if (!chunk) return;
        pendingTextRef.current += chunk;
        if (rafIdRef.current == null) {
          rafIdRef.current = requestAnimationFrame(flushQueued);
        }
      };

      const forceSetText = (text: string) => {
        cancelPendingFrame();
        pendingTextRef.current = '';
        lastAssistantText = text;
        callbacks.onTextUpdate(text);
      };

      const applyFullSnapshot = (raw: string) => {
        const full = String(raw).replace(/\r\n/g, '\n').replace(/\r/g, '\n');

        // Some backends emit occasional truncated/out-of-order "full text so far" events.
        // Never allow the UI to regress (that looks like the message is restarting).
        if (full.length < lastAssistantText.length) return;

        if (full.startsWith(lastAssistantText)) {
          queueChunk(full.slice(lastAssistantText.length));
          return;
        }

        // Fallback: accept the snapshot as the new source of truth (but only if it doesn't regress).
        forceSetText(full);
      };

      while (true) {
        let value: Uint8Array | undefined;
        let done: boolean;
        try {
          ({ value, done } = await reader.read());
        } catch {
          // Stream aborted — exit cleanly
          break;
        }
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        let sepIndex;
        while ((sepIndex = buffer.indexOf('\n\n')) !== -1) {
          const rawEvent = buffer.slice(0, sepIndex);
          buffer = buffer.slice(sepIndex + 2);

          const lines = rawEvent.split('\n');
          let eventName = 'message';
          const dataLines: string[] = [];

          for (const line of lines) {
            if (line.startsWith('event:')) {
              eventName = line.slice(6).trim();
            } else if (line.startsWith('data:')) {
              dataLines.push(line.slice(5).trim());
            }
          }

          const dataText = dataLines.join('\n');
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          let payload: any = dataText;
          try {
            payload = JSON.parse(dataText);
          } catch {}

          // Handle different event types
          if (eventName === 'assistant_partial' && payload?.text) {
            const chunk = String(payload.text)
              .replace(/\r\n/g, '\n')
              .replace(/\r/g, '\n');
            queueChunk(chunk);
          } else if (eventName === 'assistant_message' && payload?.text) {
            applyFullSnapshot(payload.text);
          } else if (eventName === 'edits' && Array.isArray(payload)) {
            callbacks.onEdits(payload);
          } else if (eventName === 'status') {
            if (payload?.state) callbacks.onStatus(payload.state);
          } else if (eventName === 'tool') {
            // Force flush pending text so tool boundary text index is accurate
            if (pendingTextRef.current) {
              cancelPendingFrame();
              lastAssistantText += pendingTextRef.current;
              pendingTextRef.current = '';
              callbacks.onTextUpdate(lastAssistantText);
            }
            const name = payload?.name ? String(payload.name) : 'tool';
            const count = typeof payload?.count === 'number' ? payload.count : undefined;
            const progressIncrement = typeof payload?.progress === 'number' ? payload.progress : undefined;
            callbacks.onToolCall(name, count, payload?.violations, progressIncrement, lastAssistantText.length);
          } else if (eventName === 'error') {
            const errorMsg = payload?.message
              ? String(payload.message)
              : 'An error occurred';
            callbacks.onError(errorMsg);
          } else if (eventName === 'result' && payload?.text) {
            applyFullSnapshot(payload.text);
            if (Array.isArray(payload.edits)) callbacks.onEdits(payload.edits);
          } else if (eventName === 'done') {
            if (payload?.text && typeof payload.text === 'string') {
              applyFullSnapshot(payload.text);
            }
            if (Array.isArray(payload?.edits) && payload.edits.length > 0) {
              callbacks.onEdits(payload.edits);
            }
          }
        }
      }

      cancelPendingFrame();
      flushQueued();
      return lastAssistantText;
    },
    []
  );

  const stopStream = useCallback(() => {
    if (abortControllerRef.current) {
      try {
        abortControllerRef.current.abort();
      } catch {}
      abortControllerRef.current = null;
    }
    if (rafIdRef.current != null) {
      cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = null;
    }
    pendingTextRef.current = '';
  }, []);

  return {
    startStream,
    parseStream,
    stopStream,
  };
}
