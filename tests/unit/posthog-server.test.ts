import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * lib/posthog-server.ts: a no-op without a key, one flushed capture per
 * event with one, and an exception capture that falls back to a raw
 * `$exception` event on posthog-node versions without captureException.
 * The flush is bounded so a hung PostHog cannot hold a response, and the
 * `...AfterResponse` helpers defer to Next's `after()` when one is in scope.
 */

const mocks = vi.hoisted(() => {
  const capture = vi.fn();
  const captureException = vi.fn();
  const flush = vi.fn().mockResolvedValue(undefined);
  const ctor = vi.fn();
  // Outside a request scope Next's after() throws; tests opt into a scope.
  const after = vi.fn((_work: () => Promise<void>): void => {
    throw new Error('`after` was called outside a request scope');
  });
  return { capture, captureException, flush, ctor, after, hasCaptureException: true };
});

vi.mock('next/server', () => ({
  after: mocks.after,
}));

vi.mock('posthog-node', () => ({
  PostHog: class PostHogMock {
    capture = mocks.capture;
    flush = mocks.flush;
    captureException?: typeof mocks.captureException;
    constructor(key: string, options: unknown) {
      mocks.ctor(key, options);
      if (mocks.hasCaptureException) this.captureException = mocks.captureException;
    }
  },
}));

import {
  afterResponse,
  captureServerEvent,
  captureServerEventAfterResponse,
  captureServerException,
  captureServerExceptionAfterResponse,
  getPostHogServer,
  resetPostHogServerForTests,
} from '@/lib/posthog-server';
import { AnalyticsEvents } from '@/lib/analytics/events';

const originalEnv = { ...process.env };

describe('posthog-server', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.hasCaptureException = true;
    delete process.env.POSTHOG_KEY;
    delete process.env.NEXT_PUBLIC_POSTHOG_KEY;
    resetPostHogServerForTests();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    resetPostHogServerForTests();
  });

  it('is a no-op without a key', async () => {
    expect(getPostHogServer()).toBeNull();
    await captureServerEvent('user_1', AnalyticsEvents.IMPORT_COMPLETED, {
      source: 'tools',
      title_length: 3,
    });
    await captureServerException(new Error('boom'), { route: 'api/test' });

    expect(mocks.ctor).not.toHaveBeenCalled();
    expect(mocks.capture).not.toHaveBeenCalled();
  });

  it('builds one serverless-tuned client and flushes each capture', async () => {
    process.env.POSTHOG_KEY = 'phc_server';

    await captureServerEvent('user_1', AnalyticsEvents.EDIT_LIMIT_HIT_SERVER, { is_pro: false });
    await captureServerEvent('user_1', AnalyticsEvents.EDIT_LIMIT_HIT_SERVER, { is_pro: false });

    expect(mocks.ctor).toHaveBeenCalledTimes(1);
    expect(mocks.ctor.mock.calls[0][0]).toBe('phc_server');
    expect(mocks.ctor.mock.calls[0][1]).toMatchObject({
      flushAt: 1,
      flushInterval: 0,
      requestTimeout: 3000,
      fetchRetryCount: 0,
    });
    expect(mocks.capture).toHaveBeenCalledTimes(2);
    expect(mocks.capture.mock.calls[0][0]).toEqual({
      distinctId: 'user_1',
      event: 'edit_limit_hit_server',
      properties: { is_pro: false, captured: 'server', source: 'server' },
    });
    expect(mocks.flush).toHaveBeenCalledTimes(2);
  });

  it("keeps an event's own source instead of overwriting it with 'server'", async () => {
    process.env.POSTHOG_KEY = 'phc_server';

    await captureServerEvent('user_1', AnalyticsEvents.IMPORT_COMPLETED, {
      source: 'tools',
      title_length: 3,
    });

    expect(mocks.capture.mock.calls[0][0]).toEqual({
      distinctId: 'user_1',
      event: 'import_completed',
      properties: { source: 'tools', title_length: 3, captured: 'server' },
    });
  });

  it('falls back to NEXT_PUBLIC_POSTHOG_KEY', () => {
    process.env.NEXT_PUBLIC_POSTHOG_KEY = 'phc_public';
    expect(getPostHogServer()).not.toBeNull();
    expect(mocks.ctor.mock.calls[0][0]).toBe('phc_public');
  });

  it('reports exceptions through captureException with the route and user', async () => {
    process.env.POSTHOG_KEY = 'phc_server';
    const error = new Error('stripe down');

    await captureServerException(error, {
      distinctId: 'user_1',
      route: 'api/checkout-session',
      extra: { step: 'create' },
    });

    expect(mocks.captureException).toHaveBeenCalledWith(error, 'user_1', {
      route: 'api/checkout-session',
      step: 'create',
    });
    expect(mocks.flush).toHaveBeenCalledTimes(1);
  });

  it('falls back to a $exception event when the SDK lacks captureException', async () => {
    process.env.POSTHOG_KEY = 'phc_server';
    mocks.hasCaptureException = false;

    await captureServerException(new TypeError('bad input'), { route: 'api/drafts' });

    expect(mocks.captureException).not.toHaveBeenCalled();
    expect(mocks.capture).toHaveBeenCalledTimes(1);
    const payload = mocks.capture.mock.calls[0][0];
    expect(payload.distinctId).toBe('server:api/drafts');
    expect(payload.event).toBe('$exception');
    expect(payload.properties.route).toBe('api/drafts');
    expect(payload.properties.$exception_list[0]).toMatchObject({
      type: 'TypeError',
      value: 'bad input',
    });
  });

  it('never throws when the SDK does', async () => {
    process.env.POSTHOG_KEY = 'phc_server';
    mocks.capture.mockImplementationOnce(() => {
      throw new Error('network');
    });
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(
      captureServerEvent('user_1', AnalyticsEvents.AI_EDIT_SERVED, {
        model: 'default',
        is_pro: true,
        sample_rate: 10,
      })
    ).resolves.toBeUndefined();
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it('bounds the flush so a hung PostHog cannot hold a response', async () => {
    process.env.POSTHOG_KEY = 'phc_server';
    vi.useFakeTimers();
    mocks.flush.mockImplementationOnce(() => new Promise<void>(() => {}));

    const pending = captureServerEvent('user_1', AnalyticsEvents.EDIT_LIMIT_HIT_SERVER, {
      is_pro: false,
    });
    let settled = false;
    void pending.then(() => {
      settled = true;
    });

    await vi.advanceTimersByTimeAsync(3000);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1000);
    expect(settled).toBe(true);
    vi.useRealTimers();
  });

  it('logs, rather than rejects, a flush that fails after the bound', async () => {
    process.env.POSTHOG_KEY = 'phc_server';
    vi.useFakeTimers();
    let rejectFlush: (error: Error) => void = () => {};
    mocks.flush.mockImplementationOnce(
      () =>
        new Promise<void>((_, reject) => {
          rejectFlush = reject;
        })
    );
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const pending = captureServerException(new Error('late'), { route: 'api/test' });
    await vi.advanceTimersByTimeAsync(4000);
    await pending;
    rejectFlush(new Error('network'));
    await vi.advanceTimersByTimeAsync(0);

    expect(errorSpy).toHaveBeenCalledWith('PostHog flush failed (api/test):', expect.any(Error));
    errorSpy.mockRestore();
    vi.useRealTimers();
  });

  it('runs the capture through after() inside a request scope', async () => {
    process.env.POSTHOG_KEY = 'phc_server';
    const scheduled: Array<() => Promise<void>> = [];
    mocks.after.mockImplementationOnce((work: () => Promise<void>) => {
      scheduled.push(work);
    });

    captureServerEventAfterResponse('user_1', AnalyticsEvents.EDIT_LIMIT_HIT_SERVER, {
      is_pro: true,
    });

    // Nothing is sent until Next runs the callback after the response.
    expect(mocks.capture).not.toHaveBeenCalled();
    expect(scheduled).toHaveLength(1);
    await scheduled[0]();
    expect(mocks.capture).toHaveBeenCalledTimes(1);
    expect(mocks.flush).toHaveBeenCalledTimes(1);
  });

  it('falls back to a fire-and-forget capture outside a request scope', async () => {
    process.env.POSTHOG_KEY = 'phc_server';

    expect(() =>
      captureServerExceptionAfterResponse(new Error('boom'), { route: 'api/drafts' })
    ).not.toThrow();
    expect(mocks.after).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => expect(mocks.captureException).toHaveBeenCalledTimes(1));
  });

  it('afterResponse never throws, even when the work rejects', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => afterResponse(() => Promise.resolve())).not.toThrow();
    errorSpy.mockRestore();
  });
});
