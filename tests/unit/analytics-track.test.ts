import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * The browser-side PostHog wrappers (lib/analytics/track.ts) must be inert
 * until posthog.init has run, and the event catalogue (lib/analytics/events.ts)
 * must stay a flat set of unique snake_case names.
 */

const posthogMock = vi.hoisted(() => ({
  __loaded: false,
  capture: vi.fn(),
  identify: vi.fn(),
  reset: vi.fn(),
  captureException: vi.fn(),
}));

vi.mock('posthog-js', () => ({ default: posthogMock }));

import {
  AnalyticsEvents,
  checkoutPlanFromAnnualFlag,
  paywallReasonForFeature,
} from '@/lib/analytics/events';
import {
  captureClientException,
  identifyUser,
  resetAnalytics,
  shouldSample,
  track,
} from '@/lib/analytics/track';

describe('event catalogue', () => {
  const names = Object.values(AnalyticsEvents);

  it('uses unique snake_case names', () => {
    expect(new Set(names).size).toBe(names.length);
    for (const name of names) {
      expect(name).toMatch(/^[a-z][a-z0-9]*(_[a-z0-9]+)*$/);
    }
  });

  it('covers the funnel end to end', () => {
    expect(names).toEqual(
      expect.arrayContaining([
        'signup_completed',
        'onboarding_completed',
        'project_created',
        'ai_edit_requested',
        'paywall_shown',
        'checkout_started',
        'subscription_started',
        'subscription_canceled',
      ])
    );
  });

  it('names the checkout plan from the historical annual flag', () => {
    expect(checkoutPlanFromAnnualFlag(true)).toBe('monthly');
    expect(checkoutPlanFromAnnualFlag(false)).toBe('weekly');
  });

  it('derives the paywall reason from the gated feature', () => {
    expect(paywallReasonForFeature('ai-edit')).toBe('daily_limit');
    expect(paywallReasonForFeature('export')).toBe('pro_feature');
    expect(paywallReasonForFeature('generate')).toBe('pro_feature');
  });
});

describe('track wrappers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    posthogMock.__loaded = false;
  });

  it('are no-ops before PostHog is initialised (no key in dev/tests)', () => {
    track(AnalyticsEvents.PROJECT_CREATED, { source: 'blank' });
    identifyUser('user_1', { email: 'a@b.c' });
    resetAnalytics();
    captureClientException(new Error('boom'));

    expect(posthogMock.capture).not.toHaveBeenCalled();
    expect(posthogMock.identify).not.toHaveBeenCalled();
    expect(posthogMock.reset).not.toHaveBeenCalled();
    expect(posthogMock.captureException).not.toHaveBeenCalled();
  });

  it('captures with the catalogue name and the given properties once loaded', () => {
    posthogMock.__loaded = true;

    track(AnalyticsEvents.EXPORT_CLICKED, { format: 'pdf', allowed: true });

    expect(posthogMock.capture).toHaveBeenCalledWith('export_clicked', {
      format: 'pdf',
      allowed: true,
    });
  });

  it('identify sends $set traits and pins signup_date/referral_source with $set_once', () => {
    posthogMock.__loaded = true;

    identifyUser('user_1', {
      email: 'a@b.c',
      provider: 'google',
      is_pro: false,
      subscription_status: null,
      referral_source: 'reddit',
      created_at: '2026-01-01T00:00:00Z',
    });

    expect(posthogMock.identify).toHaveBeenCalledWith(
      'user_1',
      {
        email: 'a@b.c',
        provider: 'google',
        is_pro: false,
        referral_source: 'reddit',
        created_at: '2026-01-01T00:00:00Z',
      },
      { signup_date: '2026-01-01T00:00:00Z', referral_source: 'reddit' }
    );
  });

  it('reset clears the person once loaded', () => {
    posthogMock.__loaded = true;
    resetAnalytics();
    expect(posthogMock.reset).toHaveBeenCalledTimes(1);
  });

  it('never throws when the SDK does', () => {
    posthogMock.__loaded = true;
    posthogMock.capture.mockImplementationOnce(() => {
      throw new Error('network');
    });
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(() => track(AnalyticsEvents.PAYWALL_DISMISSED, { feature: 'export' })).not.toThrow();
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it('shouldSample keeps everything at rate 1 and roughly 1 in N otherwise', () => {
    expect(shouldSample(1)).toBe(true);
    expect(shouldSample(0)).toBe(true);

    const randomSpy = vi.spyOn(Math, 'random');
    randomSpy.mockReturnValue(0.05);
    expect(shouldSample(10)).toBe(true);
    randomSpy.mockReturnValue(0.5);
    expect(shouldSample(10)).toBe(false);
    randomSpy.mockRestore();
  });
});
