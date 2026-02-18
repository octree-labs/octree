/**
 * Stream handling utilities for Vercel AI SDK fullStream
 * Maps AI SDK stream parts to SSE events
 */

import type { Response } from 'express';
import type { StringEdit } from './edits.js';

/**
 * Create response headers for Server-Sent Events
 */
export function createSSEHeaders() {
  return {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  };
}

/**
 * Create a writeEvent function for an Express response
 */
export function createWriteEvent(res: Response) {
  return (event: string, data: unknown) => {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };
}

/**
 * Process Vercel AI SDK fullStream and emit SSE events
 */
export async function processFullStream(
  fullStream: AsyncIterable<unknown>,
  writeEvent: (event: string, data: unknown) => void,
  collectedEdits: StringEdit[]
): Promise<string> {
  let finalText = '';

  try {
    for await (const part of fullStream) {
      const p = part as { type: string; textDelta?: string; toolName?: string; args?: unknown; result?: unknown; error?: unknown };

      switch (p.type) {
        case 'text-delta': {
          if (p.textDelta) {
            const text = p.textDelta
              .split('\r\n').join('\n')
              .split('\r').join('\n');
            finalText += text;
            writeEvent('assistant_partial', { text });
          }
          break;
        }

        case 'tool-call': {
          // Tool is being called — emit progress info
          // The actual execution and edit events happen in the tool's execute function
          break;
        }

        case 'tool-result': {
          // Tool finished — result already handled by tool's execute function
          break;
        }

        case 'step-finish': {
          // A step (one LLM call) finished. Text so far is accumulated.
          break;
        }

        case 'error': {
          const errorMsg = p.error instanceof Error ? p.error.message : String(p.error);
          writeEvent('error', { message: errorMsg });
          break;
        }

        case 'finish': {
          // Stream is done
          break;
        }
      }
    }
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : 'Stream error';
    writeEvent('error', { message: errorMsg });
  }

  return finalText;
}
