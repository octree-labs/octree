import { describe, it, expect, vi, beforeEach } from 'vitest';

const { upsertUserUsage } = vi.hoisted(() => ({
  upsertUserUsage: vi.fn(async () => undefined),
}));

vi.mock('@/lib/requests/user', () => ({ upsertUserUsage }));
vi.mock('@/lib/analytics/track', () => ({ track: vi.fn() }));

import { completeFreeOnboarding, isSignUpAlreadyTracked } from '@/lib/requests/onboarding';

// Accounts created through Google OAuth never pass through the sign-up form.
const oauthUser = {
  id: 'user_1',
  email: 'free@example.com',
  app_metadata: { provider: 'google', providers: ['google'] },
};

// The email sign-up form already reports SignUp when the account is created.
const emailUser = {
  id: 'user_2',
  email: 'email@example.com',
  app_metadata: { provider: 'email', providers: ['email'] },
};

function readBlob(blob: Blob): Promise<unknown> {
  // jsdom's Blob has no .text(); FileReader works in both jsdom and Node.
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(JSON.parse(String(reader.result)));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(blob);
  });
}

function lastBeaconPayload(sendBeacon: ReturnType<typeof vi.fn>) {
  const [url, blob] = sendBeacon.mock.calls.at(-1)!;
  return { url, body: readBlob(blob as Blob) };
}

describe('isSignUpAlreadyTracked', () => {
  it('is true only for accounts created with the email form', () => {
    expect(isSignUpAlreadyTracked(emailUser)).toBe(true);
    expect(isSignUpAlreadyTracked(oauthUser)).toBe(false);
    expect(isSignUpAlreadyTracked({ id: 'x', email: 'x@example.com' })).toBe(false);
  });
});

describe('completeFreeOnboarding', () => {
  let rdt: ReturnType<typeof vi.fn>;
  let sendBeacon: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    rdt = vi.fn();
    sendBeacon = vi.fn(() => true);
    window.rdt = rdt;
    Object.defineProperty(navigator, 'sendBeacon', { value: sendBeacon, configurable: true });
  });

  it('marks onboarding complete the same way the Stripe webhook does', async () => {
    await completeFreeOnboarding(oauthUser);

    expect(upsertUserUsage).toHaveBeenCalledTimes(1);
    expect(upsertUserUsage).toHaveBeenCalledWith('user_1', { onboarding_completed: true });
  });

  it('reports the referral answer on the completion event, and omits it when absent', async () => {
    const { track } = await import('@/lib/analytics/track');
    const spy = vi.mocked(track);
    spy.mockClear();

    await completeFreeOnboarding(oauthUser, { referralSource: 'search' });
    expect(spy).toHaveBeenLastCalledWith('onboarding_completed', {
      plan: 'free',
      referral_source: 'search',
    });

    await completeFreeOnboarding(oauthUser, { referralSource: '' });
    expect(spy).toHaveBeenLastCalledWith('onboarding_completed', { plan: 'free' });
  });

  it('fires the Reddit SignUp pixel and mirrors it to the CAPI route for OAuth sign-ups', async () => {
    await completeFreeOnboarding(oauthUser);

    expect(rdt).toHaveBeenCalledWith('track', 'SignUp', {
      conversionId: expect.any(String),
    });

    const { url, body } = lastBeaconPayload(sendBeacon);
    expect(url).toBe('/api/reddit-capi');
    await expect(body).resolves.toEqual({
      eventName: 'SignUp',
      conversionId: rdt.mock.calls[0][2].conversionId,
      email: 'free@example.com',
    });
  });

  it('does not report SignUp again for email sign-ups (the form already did)', async () => {
    await completeFreeOnboarding(emailUser);

    expect(upsertUserUsage).toHaveBeenCalledWith('user_2', { onboarding_completed: true });
    expect(rdt).not.toHaveBeenCalled();
    expect(sendBeacon).not.toHaveBeenCalled();
  });

  it('does not report a sign-up when the flag could not be saved', async () => {
    upsertUserUsage.mockRejectedValueOnce(new Error('Failed to save user data'));

    await expect(completeFreeOnboarding(oauthUser)).rejects.toThrow('Failed to save user data');
    expect(rdt).not.toHaveBeenCalled();
    expect(sendBeacon).not.toHaveBeenCalled();
  });

  it('still completes when tracking is unavailable', async () => {
    window.rdt = undefined;
    Object.defineProperty(navigator, 'sendBeacon', { value: undefined, configurable: true });

    await expect(completeFreeOnboarding({ id: 'user_1', app_metadata: { provider: 'google' } })).resolves.toBeUndefined();
    expect(upsertUserUsage).toHaveBeenCalledWith('user_1', { onboarding_completed: true });
  });
});
