// Server-only: never import from a client component (posthog-node is Node only).

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
 */

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
 * Captures one server-side event for a Supabase user id and waits for the
 * flush so it is on the wire before the function returns. Resolves on error.
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
    await posthog.flush();
  } catch (error) {
    console.error(`PostHog capture failed (${event}):`, error);
  }
}

export interface ServerExceptionContext {
  /** Supabase user id when the request is authenticated. */
  distinctId?: string | null;
  /** Route or handler name, e.g. `api/checkout-session`. */
  route: string;
  extra?: Record<string, unknown>;
}

/**
 * Reports a caught error to PostHog error tracking. Uses posthog-node's
 * `captureException` and falls back to a raw `$exception` event on versions
 * without it. Never throws and never changes the caller's response.
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
    await posthog.flush();
  } catch (captureError) {
    console.error(`PostHog captureException failed (${route}):`, captureError);
  }
}
