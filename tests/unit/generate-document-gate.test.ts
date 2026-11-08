import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * The allowance gate in app/api/generate-document/route.ts: what each
 * `consume_generation` answer turns into (proceed vs 402 with both offers),
 * when the allowance is consumed (after validation, before the model call)
 * and when it is handed back (`refund_generation`: the model produced
 * nothing). The Anthropic call is a mocked `fetch`.
 */

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  rpc: vi.fn(),
  adminRpc: vi.fn(),
  captureEvent: vi.fn(),
  captureException: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: mocks.getUser },
    rpc: mocks.rpc,
  }),
}));

// refund_generation is service-role only; the route reaches it through the
// admin client, never the user's session.
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({ rpc: mocks.adminRpc }),
}));

vi.mock('@/lib/posthog-server', () => ({
  captureServerEventAfterResponse: mocks.captureEvent,
  captureServerExceptionAfterResponse: mocks.captureException,
}));

// A short deadline so the "route stops reading at the deadline" path runs
// in milliseconds; everything else in this file finishes well before it.
vi.mock('@/lib/generate/output', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/generate/output')>()),
  GENERATE_DEADLINE_MS: 50,
}));

process.env.ANTHROPIC_API_KEY = 'test-key';

import { POST } from '@/app/api/generate-document/route';

const freeUser = { id: 'user-1', email: 'free@example.com' };
// First entry of lib/paywall.ts UNLIMITED_EDIT_EMAILS.
const unlimitedUser = { id: 'user-2', email: 'rascodes123@gmail.com' };

const LATEX = '\\documentclass{article}\\begin{document}Hello\\end{document}';

function makeRequest(body: Record<string, unknown> = { prompt: 'Write a short note' }) {
  return new Request('http://localhost/api/generate-document', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function anthropicStream(texts: string[], stopReason: string = 'end_turn', outputTokens = 42) {
  const encoder = new TextEncoder();
  return {
    ok: true,
    body: new ReadableStream({
      start(controller) {
        for (const text of texts) {
          const event = { type: 'content_block_delta', delta: { text } };
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        }
        const end = {
          type: 'message_delta',
          delta: { stop_reason: stopReason },
          usage: { output_tokens: outputTokens },
        };
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(end)}\n\n`));
        controller.close();
      },
    }),
  };
}

/** Sends `texts`, then hangs until the route aborts the request. */
function anthropicHanging(texts: string[]) {
  const encoder = new TextEncoder();
  return (_url: string, init: { signal: AbortSignal }) =>
    Promise.resolve({
      ok: true,
      body: new ReadableStream({
        start(controller) {
          for (const text of texts) {
            const event = { type: 'content_block_delta', delta: { text } };
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
          }
          init.signal.addEventListener('abort', () =>
            controller.error(new DOMException('aborted', 'AbortError'))
          );
        },
      }),
    });
}

/** Some text, then Anthropic's mid-stream `error` event (e.g. overloaded). */
function anthropicMidStreamError(texts: string[]) {
  const encoder = new TextEncoder();
  return {
    ok: true,
    body: new ReadableStream({
      start(controller) {
        for (const text of texts) {
          const event = { type: 'content_block_delta', delta: { text } };
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        }
        const err = { type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } };
        controller.enqueue(encoder.encode(`event: error\ndata: ${JSON.stringify(err)}\n\n`));
        controller.close();
      },
    }),
  };
}

function anthropicFailure(status = 529) {
  return { ok: false, status, text: async () => 'overloaded' };
}

/** Parses the SSE response into [event, data] pairs. */
async function readEvents(res: Response): Promise<Array<[string, any]>> {
  const text = await res.text();
  const events: Array<[string, any]> = [];
  for (const block of text.split('\n\n')) {
    const eventLine = block.split('\n').find((l) => l.startsWith('event: '));
    const dataLine = block.split('\n').find((l) => l.startsWith('data: '));
    if (eventLine && dataLine) {
      events.push([eventLine.slice(7), JSON.parse(dataLine.slice(6))]);
    }
  }
  return events;
}

function rpcAnswering(kind: string | null, error: unknown = null) {
  mocks.rpc.mockImplementation(async (fn: string) => {
    if (fn === 'consume_generation') return { data: kind, error };
    throw new Error(`unexpected rpc ${fn}`);
  });
}

function refundCalls() {
  return mocks.adminRpc.mock.calls.filter(([fn]) => fn === 'refund_generation');
}

function userSessionRefundCalls() {
  return mocks.rpc.mock.calls.filter(([fn]) => fn === 'refund_generation');
}

describe('POST /api/generate-document allowance gate', () => {
  let fetchSpy: ReturnType<typeof vi.fn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getUser.mockResolvedValue({ data: { user: freeUser }, error: null });
    mocks.adminRpc.mockResolvedValue({ data: true, error: null });
    fetchSpy = vi.fn().mockResolvedValue(anthropicStream([LATEX]));
    global.fetch = fetchSpy as any;
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    errorSpy.mockRestore();
  });

  describe('decision table', () => {
    it.each([['pro'], ['free'], ['credit']])(
      'consume_generation -> %s: the generation proceeds and the kind is reported',
      async (kind) => {
        rpcAnswering(kind);

        const res = await POST(makeRequest());

        expect(res.status).toBe(200);
        expect(mocks.rpc).toHaveBeenCalledWith('consume_generation', { p_user_id: 'user-1' });
        const events = await readEvents(res);
        expect(events.find(([e]) => e === 'complete')?.[1]).toMatchObject({ latex: LATEX });
        expect(refundCalls()).toHaveLength(0);
        expect(mocks.captureEvent).toHaveBeenCalledWith('user-1', 'generate_allowance_used', {
          kind,
          is_continuation: false,
        });
      }
    );

    it('consume_generation -> blocked: 402 with both offers, no model call', async () => {
      rpcAnswering('blocked');

      const res = await POST(makeRequest());

      expect(res.status).toBe(402);
      await expect(res.json()).resolves.toMatchObject({
        upgradeRequired: true,
        reason: 'generate_quota',
        offers: ['pro', 'single'],
      });
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(mocks.captureEvent).not.toHaveBeenCalled();
    });

    it('an RPC error fails closed (503, not the paywall), it does not grant a free generation', async () => {
      rpcAnswering(null, { message: 'function consume_generation does not exist' });

      const res = await POST(makeRequest());

      expect(res.status).toBe(503);
      await expect(res.json()).resolves.not.toHaveProperty('upgradeRequired');
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(mocks.captureEvent).not.toHaveBeenCalled();
    });

    it('an unexpected RPC answer fails closed (503) without a model call', async () => {
      rpcAnswering('unlimited');

      const res = await POST(makeRequest());

      expect(res.status).toBe(503);
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('whitelisted accounts count as Pro without touching the database', async () => {
      mocks.getUser.mockResolvedValue({ data: { user: unlimitedUser }, error: null });

      const res = await POST(makeRequest());

      expect(res.status).toBe(200);
      expect(mocks.rpc).not.toHaveBeenCalled();
      expect(mocks.captureEvent).toHaveBeenCalledWith('user-2', 'generate_allowance_used', {
        kind: 'pro',
        is_continuation: false,
      });
    });
  });

  describe('model call', () => {
    it('asks for enough output room for long documents and reports the stop reason', async () => {
      rpcAnswering('free');

      const res = await POST(makeRequest());
      const events = await readEvents(res);

      const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
      expect(body.max_tokens).toBeGreaterThanOrEqual(32000);
      expect(body.stream).toBe(true);
      expect(events.find(([e]) => e === 'complete')?.[1]).toMatchObject({
        stop_reason: 'end_turn',
        output_tokens: 42,
      });
    });
  });

  describe('consume timing', () => {
    it('does not consume for an unauthenticated request', async () => {
      mocks.getUser.mockResolvedValue({ data: { user: null }, error: null });

      const res = await POST(makeRequest());

      expect(res.status).toBe(401);
      expect(mocks.rpc).not.toHaveBeenCalled();
    });

    it('does not consume when the request is invalid (no prompt)', async () => {
      rpcAnswering('free');

      const res = await POST(makeRequest({ prompt: '   ' }));

      expect(res.status).toBe(400);
      expect(mocks.rpc).not.toHaveBeenCalled();
    });

    it('refuses an oversized prompt with a 400 before consuming anything', async () => {
      rpcAnswering('free');

      const res = await POST(makeRequest({ prompt: 'a'.repeat(100_001) }));

      expect(res.status).toBe(400);
      await expect(res.json()).resolves.toMatchObject({ code: 'too_long' });
      expect(mocks.rpc).not.toHaveBeenCalled();
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('consumes before the model call is made', async () => {
      const order: string[] = [];
      mocks.rpc.mockImplementation(async (fn: string) => {
        order.push(fn);
        return { data: 'free', error: null };
      });
      fetchSpy.mockImplementation(async () => {
        order.push('fetch');
        return anthropicStream([LATEX]);
      });

      const res = await POST(makeRequest());
      await res.text();

      expect(order).toEqual(['consume_generation', 'fetch']);
    });

    it('reports a continuation to analytics', async () => {
      rpcAnswering('credit');

      const res = await POST(
        makeRequest({ prompt: 'Add a conclusion', documentId: 'doc-1', currentLatex: LATEX })
      );
      await res.text();

      expect(mocks.captureEvent).toHaveBeenCalledWith('user-1', 'generate_allowance_used', {
        kind: 'credit',
        is_continuation: true,
      });
    });
  });

  describe('refund', () => {
    it.each([['free'], ['credit']])(
      'hands a %s generation back when the model call fails before any output',
      async (kind) => {
        rpcAnswering(kind);
        fetchSpy.mockResolvedValue(anthropicFailure());

        const res = await POST(makeRequest());
        const events = await readEvents(res);

        expect(events.find(([e]) => e === 'error')).toBeTruthy();
        expect(refundCalls()).toEqual([
          ['refund_generation', { p_user_id: 'user-1', p_kind: kind }],
        ]);
        // Never through the user's session: the RPC is not executable by it.
        expect(userSessionRefundCalls()).toHaveLength(0);
      }
    );

    it('hands the generation back when fetch itself throws', async () => {
      rpcAnswering('free');
      fetchSpy.mockRejectedValue(new Error('ECONNRESET'));

      const res = await POST(makeRequest());
      await res.text();

      expect(refundCalls()).toHaveLength(1);
    });

    it('never refunds a Pro generation', async () => {
      rpcAnswering('pro');
      fetchSpy.mockResolvedValue(anthropicFailure());

      const res = await POST(makeRequest());
      await res.text();

      expect(refundCalls()).toHaveLength(0);
    });

    it('does not refund once the model produced output, even if it was not valid LaTeX', async () => {
      rpcAnswering('free');
      fetchSpy.mockResolvedValue(anthropicStream(['Sorry, I cannot do that.']));

      const res = await POST(makeRequest());
      const events = await readEvents(res);

      expect(events.find(([e]) => e === 'error')?.[1]).toMatchObject({
        message: 'Failed to generate valid LaTeX document',
      });
      expect(refundCalls()).toHaveLength(0);
    });

    it('hands the generation back when the document is cut off at max_tokens', async () => {
      rpcAnswering('free');
      fetchSpy.mockResolvedValue(
        anthropicStream(['\\documentclass{article}\\begin{document}Long text'], 'max_tokens', 32000)
      );

      const res = await POST(makeRequest());
      const events = await readEvents(res);

      expect(events.find(([e]) => e === 'error')?.[1]).toMatchObject({
        code: 'truncated',
        stop_reason: 'max_tokens',
        output_tokens: 32000,
      });
      expect(events.find(([e]) => e === 'complete')).toBeUndefined();
      expect(refundCalls()).toEqual([
        ['refund_generation', { p_user_id: 'user-1', p_kind: 'free' }],
      ]);
    });

    it('reports a cut-off at the deadline as truncated and refunds exactly once', async () => {
      rpcAnswering('credit');
      fetchSpy.mockImplementation(anthropicHanging(['\\documentclass{article}\\begin{document}Part']));

      const res = await POST(makeRequest());
      const events = await readEvents(res);

      expect(events.find(([e]) => e === 'error')?.[1]).toMatchObject({
        code: 'truncated',
        stop_reason: 'deadline',
      });
      expect(refundCalls()).toEqual([
        ['refund_generation', { p_user_id: 'user-1', p_kind: 'credit' }],
      ]);
    });

    it('refunds a credit only once when the deadline hits before any output', async () => {
      rpcAnswering('credit');
      fetchSpy.mockImplementation(anthropicHanging([]));

      const res = await POST(makeRequest());
      const events = await readEvents(res);

      expect(events.filter(([e]) => e === 'error')).toHaveLength(1);
      expect(refundCalls()).toHaveLength(1);
    });

    it('a mid-stream provider error is a server error with a refund, not "invalid LaTeX"', async () => {
      rpcAnswering('free');
      fetchSpy.mockResolvedValue(
        anthropicMidStreamError(['\\documentclass{article}\\begin{document}Some'])
      );

      const res = await POST(makeRequest());
      const events = await readEvents(res);

      const error = events.find(([e]) => e === 'error')?.[1];
      expect(error).toMatchObject({ code: 'upstream' });
      expect(error.message).not.toMatch(/overloaded_error|API error/);
      expect(refundCalls()).toHaveLength(1);
    });

    it('does not show the raw provider response to the user', async () => {
      rpcAnswering('free');
      fetchSpy.mockResolvedValue(anthropicFailure(400));

      const res = await POST(makeRequest());
      const events = await readEvents(res);

      expect(events.find(([e]) => e === 'error')?.[1].message).not.toMatch(/API error|overloaded/);
    });

    it('stops the model call when the browser goes away', async () => {
      rpcAnswering('free');
      let signal: AbortSignal | undefined;
      const hanging = anthropicHanging(['\\documentclass{article}\\begin{document}' + 'x'.repeat(200)]);
      fetchSpy.mockImplementation((url: string, init: { signal: AbortSignal }) => {
        signal = init.signal;
        return hanging(url, init);
      });

      const res = await POST(makeRequest());
      const reader = res.body!.getReader();
      await reader.read();
      await reader.cancel();
      await new Promise((r) => setTimeout(r, 10));

      expect(signal?.aborted).toBe(true);
      // Output had arrived: stopping it is not a refund.
      expect(refundCalls()).toHaveLength(0);
    });

    it('still reports the error when the refund RPC itself fails', async () => {
      rpcAnswering('free');
      mocks.adminRpc.mockRejectedValue(new Error('db down'));
      fetchSpy.mockResolvedValue(anthropicFailure());

      const res = await POST(makeRequest());
      const events = await readEvents(res);

      expect(events.find(([e]) => e === 'error')).toBeTruthy();
      expect(errorSpy).toHaveBeenCalled();
    });
  });
});
