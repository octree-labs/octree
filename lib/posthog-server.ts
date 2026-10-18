import 'server-only';

import { after } from 'next/server';
import { PostHog } from 'posthog-node';

import type { AnalyticsEvent, AnalyticsEventProperties } from '@/lib/analytics/events';

/**
 * Server-side PostHog (API routes, server actions, webhooks).
 *
 * The client is a per-process singleton configured for serverless: every
 * capture is flushed on its own (`flushAt: 1, flushInterval: 0`) so an event
 * is never left in an in-memory queue when the function is frozen. Without a
 * key (dev, tests) every helper is a no-op. Nothing here ever throws: analytics
 * must not be able to fail a webhook or a checkout.
 *
 * Latency: a capture is bounded. The HTTP request times out after
 * REQUEST_TIMEOUT_MS with no retries, and the flush itself is raced against
 * FLUSH_TIMEOUT_MS, so an unreachable PostHog costs a few seconds at most.
 * Route handlers should not even pay that: the `...AfterResponse` helpers run
 * the capture through Next's `after()`, after the response has been sent,
 * while Vercel keeps the function alive until it settles.
 */

const REQUEST_TIMEOUT_MS = 3000;
const FLUSH_TIMEOUT_MS = 3500;

let client: PostHog | null | undefined;

function getKey(): string | undefined {
  return process.env.POSTHOG_KEY || process.env.NEXT_PUBLIC_POSTHOG_KEY || undefined;
}

export function getPostHogServer(): PostHog | null {
  if (client !== undefined) return client;
  const key = getKey();
  if (!key) {
    client = null;
    return client;
  }
  try {
    client = new PostHog(key, {
      host: process.env.NEXT_PUBLIC_POSTHOG_HOST || 'https://us.i.posthog.com',
      flushAt: 1,
      flushInterval: 0,
      requestTimeout: REQUEST_TIMEOUT_MS,
      fetchRetryCount: 0,
    });
  } catch (error) {
    console.error('PostHog server client failed to initialise:', error);
    client = null;
  }
  return client;
}

/** Test hook: drop the cached client so a new key is picked up. */
export function resetPostHogServerForTests(): void {
  client = undefined;
}

/**
 * Waits for the queue to reach the wire, but never longer than
 * FLUSH_TIMEOUT_MS. A late failure of the underlying flush is logged, never
 * surfaced as an unhandled rejection.
 */
async function flushBounded(posthog: PostHog, label: string): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, FLUSH_TIMEOUT_MS);
  });
  const flush = posthog.flush().catch((error) => {
    console.error(`PostHog flush failed (${label}):`, error);
  });
  try {
    await Promise.race([flush, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Runs analytics work after the response has been sent. Inside a request
 * scope this is Next's `after()`, which keeps the function alive until the
 * promise settles; outside one (unit tests, scripts) the work simply starts
 * without being awaited. Never throws.
 */
export function afterResponse(work: () => Promise<void>): void {
  try {
    after(work);
  } catch {
    void work();
  }
}

/**
 * Captures one server-side event for a Supabase user id and waits (bounded)
 * for the flush so it is on the wire before the function returns. Resolves on
 * error. Prefer `captureServerEventAfterResponse` inside route handlers.
 */
export async function captureServerEvent<E extends AnalyticsEvent>(
  distinctId: string,
  event: E,
  properties: AnalyticsEventProperties[E]
): Promise<void> {
  const posthog = getPostHogServer();
  if (!posthog) return;
  try {
    posthog.capture({ distinctId, event, properties: { ...properties, source: 'server' } });
    await flushBounded(posthog, event);
  } catch (error) {
    console.error(`PostHog capture failed (${event}):`, error);
  }
}

/** `captureServerEvent`, run after the response so it never adds latency. */
export function captureServerEventAfterResponse<E extends AnalyticsEvent>(
  distinctId: string,
  event: E,
  properties: AnalyticsEventProperties[E]
): void {
  afterResponse(() => captureServerEvent(distinctId, event, properties));
}

export interface ServerExceptionContext {
  /** Supabase user id when the request is authenticated. */
  distinctId?: string | null;
  /** Route or handler name, e.g. `api/checkout-session`. */
  route: string;
  /**
   * Small, non-sensitive context such as a step name. Never a request body,
   * a document, a prompt or a secret.
   */
  extra?: Record<string, string | number | boolean | null | undefined>;
}

/**
 * Reports a caught error to PostHog error tracking. Uses posthog-node's
 * `captureException` and falls back to a raw `$exception` event on versions
 * without it. Never throws and never changes the caller's response. Prefer
 * `captureServerExceptionAfterResponse` inside route handlers.
 */
export async function captureServerException(
  error: unknown,
  { distinctId, route, extra }: ServerExceptionContext
): Promise<void> {
  const posthog = getPostHogServer();
  if (!posthog) return;
  const id = distinctId || `server:${route}`;
  const properties = { route, ...extra };
  try {
    const withCaptureException = posthog as PostHog & {
      captureException?: (
        err: unknown,
        distinctId?: string,
        additionalProperties?: Record<string, unknown>
      ) => void;
    };
    if (typeof withCaptureException.captureException === 'function') {
      withCaptureException.captureException(error, id, properties);
    } else {
      const err = error instanceof Error ? error : new Error(String(error));
      posthog.capture({
        distinctId: id,
        event: '$exception',
        properties: {
          ...properties,
          $exception_list: [
            {
              type: err.name,
              value: err.message,
              mechanism: { handled: true, synthetic: false },
              stacktrace: err.stack
                ? { type: 'raw', frames: [], raw: err.stack }
                : undefined,
            },
          ],
        },
      });
    }
    await flushBounded(posthog, route);
  } catch (captureError) {
    console.error(`PostHog captureException failed (${route}):`, captureError);
  }
}

/** `captureServerException`, run after the response so it never adds latency. */
export function captureServerExceptionAfterResponse(
  error: unknown,
  context: ServerExceptionContext
): void {
  afterResponse(() => captureServerException(error, context));
}
