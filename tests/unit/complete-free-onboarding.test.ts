import { describe, it, expect, vi, beforeEach } from 'vitest';

const { upsertUserUsage } = vi.hoisted(() => ({
  upsertUserUsage: vi.fn(async () => undefined),
}));

vi.mock('@/lib/requests/user', () => ({ upsertUserUsage }));

import { completeFreeOnboarding } from '@/lib/requests/onboarding';

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
    await completeFreeOnboarding('user_1', 'free@example.com');

    expect(upsertUserUsage).toHaveBeenCalledTimes(1);
    expect(upsertUserUsage).toHaveBeenCalledWith('user_1', { onboarding_completed: true });
  });

  it('fires the Reddit SignUp pixel and mirrors it to the CAPI route', async () => {
    await completeFreeOnboarding('user_1', 'free@example.com');

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

  it('does not report a sign-up when the flag could not be saved', async () => {
    upsertUserUsage.mockRejectedValueOnce(new Error('Failed to save user data'));

    await expect(completeFreeOnboarding('user_1', 'free@example.com')).rejects.toThrow(
      'Failed to save user data'
    );
    expect(rdt).not.toHaveBeenCalled();
    expect(sendBeacon).not.toHaveBeenCalled();
  });

  it('still completes when tracking is unavailable', async () => {
    window.rdt = undefined;
    Object.defineProperty(navigator, 'sendBeacon', { value: undefined, configurable: true });

    await expect(completeFreeOnboarding('user_1')).resolves.toBeUndefined();
    expect(upsertUserUsage).toHaveBeenCalledWith('user_1', { onboarding_completed: true });
  });
});
