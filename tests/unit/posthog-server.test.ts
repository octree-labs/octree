import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * lib/posthog-server.ts: a no-op without a key, one flushed capture per
 * event with one, and an exception capture that falls back to a raw
 * `$exception` event on posthog-node versions without captureException.
 */

const mocks = vi.hoisted(() => {
  const capture = vi.fn();
  const captureException = vi.fn();
  const flush = vi.fn().mockResolvedValue(undefined);
  const ctor = vi.fn();
  return { capture, captureException, flush, ctor, hasCaptureException: true };
});

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
  captureServerEvent,
  captureServerException,
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
      title: 'Doc',
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
    expect(mocks.ctor.mock.calls[0][1]).toMatchObject({ flushAt: 1, flushInterval: 0 });
    expect(mocks.capture).toHaveBeenCalledTimes(2);
    expect(mocks.capture.mock.calls[0][0]).toEqual({
      distinctId: 'user_1',
      event: 'edit_limit_hit_server',
      properties: { is_pro: false, source: 'server' },
    });
    expect(mocks.flush).toHaveBeenCalledTimes(2);
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
});
