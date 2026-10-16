/**
 * Stream handling utilities for Server-Sent Events (SSE)
 * Provides utilities for managing streaming responses and event handling
 */

export interface StreamController {
  enqueue: (chunk: Uint8Array) => void;
  close: () => void;
}

export interface StreamMessage {
  type: string;
  subtype?: string;
  result?: string;
  message?: {
    content?: Array<{
      type: string;
      text?: string;
    }>;
  };
  event?: {
    delta?: {
      text?: string;
      partial_text?: string;
    };
  };
}

/**
 * Create a readable stream for Server-Sent Events
 * @returns Object with stream and writeEvent function
 */
export function createSSEStream() {
  const encoder = new TextEncoder();
  let streamController: StreamController | null = null;
  
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      // Cast to structural type for Node/Edge compatibility without DOM lib
      streamController = controller as unknown as StreamController;
      
      // Heartbeat to keep SSE connection alive for intermediaries
      const hb = setInterval(() => {
        try {
          writeEvent('ping', Date.now());
        } catch {}
      }, 15000);
      
      // Store cleanup on controller
      (streamController as unknown as { __hb?: NodeJS.Timeout }).__hb = hb as NodeJS.Timeout;
    },
    cancel() {
      try {
        const anyCtrl = streamController as unknown as { __hb?: NodeJS.Timeout } | null;
        if (anyCtrl?.__hb) clearInterval(anyCtrl.__hb);
      } catch {}
      streamController = null;
    },
  });

  const writeEvent = (event: string, data: unknown) => {
    if (!streamController) return;
    const payload = typeof data === 'string' ? data : JSON.stringify(data);
    const chunk = encoder.encode(`event: ${event}\ndata: ${payload}\n\n`);
    streamController.enqueue(chunk);
  };

  const cleanup = () => {
    try {
      const anyCtrl = streamController as unknown as { __hb?: NodeJS.Timeout; close?: () => void } | null;
      if (anyCtrl?.__hb) clearInterval(anyCtrl.__hb);
    } catch {}
    (streamController as unknown as { close?: () => void } | null)?.close?.();
  };

  return {
    stream,
    writeEvent,
    cleanup
  };
}

/**
 * Process streaming messages from the AI agent
 * @param messages - Async iterator of messages
 * @param writeEvent - Function to write events to the stream
 * @param collectedEdits - Array to collect edits
 * @returns Promise that resolves with final text
 */
export async function processStreamMessages(
  messages: AsyncIterable<StreamMessage>,
  writeEvent: (event: string, data: unknown) => void,
  collectedEdits: unknown[]
): Promise<string> {
  let finalText = '';
  
  try {
    for await (const msg of messages) {
      // Partial streaming events
      if ((msg as { type?: string })?.type === 'stream_event') {
        const delta = (msg as { event?: { delta?: { text?: string; partial_text?: string } } })?.event?.delta;
        const text = (delta?.text ?? delta?.partial_text ?? '')
          .split('\r\n').join('\n')
          .split('\r').join('\n');
        if (text) {
          writeEvent('assistant_partial', { text });
        }
        continue;
      }

      if (msg.type === 'assistant') {
        try {
          const parts = (msg as { message?: { content?: unknown[] } })?.message?.content || [];
          const textParts = parts
            .filter((p: unknown) => (p as { type?: string; text?: string })?.type === 'text' && typeof (p as { text?: string })?.text === 'string')
            .map((p: unknown) => String((p as { text: string }).text).split('\r\n').join('\n').split('\r').join('\n'))
            .join('\n');
          if (textParts) {
            finalText = textParts;
            writeEvent('assistant_message', { text: textParts });
          }
        } catch {}
        continue;
      }

      if (msg.type === 'result' && msg.subtype === 'success') {
        finalText = msg.result || finalText;
        writeEvent('result', { text: finalText, edits: collectedEdits });
        continue;
      }
    }
  } catch (err) {
    writeEvent('error', { message: (err as Error)?.message || 'Stream error' });
  }
  
  return finalText;
}

/**
 * Create response headers for Server-Sent Events
 * @returns Headers object for SSE response
 */
export function createSSEHeaders() {
  return {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  };
}
