import { describe, it, expect } from 'vitest';

import {
  hasFinishedOnboarding,
  onboardingPaywallApplies,
  onboardingPath,
  safeNextPath,
  shouldRedirectToOnboarding,
} from '@/lib/onboarding/paywall-gate';

const newUser = { is_pro: false, onboarding_completed: false };
const onboardedFree = { is_pro: false, onboarding_completed: true };
const pro = { is_pro: true, onboarding_completed: true };
// The webhook writes both; this is the moment between payment and the flag.
const proFlagLagging = { is_pro: true, onboarding_completed: false };

describe('shouldRedirectToOnboarding, paywall on', () => {
  it('sends a new non-Pro user to /onboarding from the dashboard, editor and /generate', () => {
    expect(shouldRedirectToOnboarding(newUser, 'dashboard', true)).toBe(true);
    expect(shouldRedirectToOnboarding(newUser, 'app', true)).toBe(true);
  });

  it('treats a missing user_usage row (brand-new account) as a new user', () => {
    expect(shouldRedirectToOnboarding(null, 'app', true)).toBe(true);
    expect(shouldRedirectToOnboarding(undefined, 'dashboard', true)).toBe(true);
    expect(shouldRedirectToOnboarding({ is_pro: null, onboarding_completed: null }, 'app', true)).toBe(true);
  });

  it('lets an already-onboarded free user in everywhere (no lock-out of existing users)', () => {
    expect(shouldRedirectToOnboarding(onboardedFree, 'dashboard', true)).toBe(false);
    expect(shouldRedirectToOnboarding(onboardedFree, 'app', true)).toBe(false);
  });

  it('lets a Pro user in, even before the onboarding flag lands', () => {
    expect(shouldRedirectToOnboarding(pro, 'dashboard', true)).toBe(false);
    expect(shouldRedirectToOnboarding(pro, 'app', true)).toBe(false);
    expect(shouldRedirectToOnboarding(proFlagLagging, 'dashboard', true)).toBe(false);
    expect(shouldRedirectToOnboarding(proFlagLagging, 'app', true)).toBe(false);
  });
});

describe('shouldRedirectToOnboarding, paywall off (behaviour before this switch)', () => {
  it('only the dashboard sends a not-onboarded user to /onboarding', () => {
    expect(shouldRedirectToOnboarding(newUser, 'dashboard', false)).toBe(true);
    expect(shouldRedirectToOnboarding(null, 'dashboard', false)).toBe(true);
    expect(shouldRedirectToOnboarding(newUser, 'app', false)).toBe(false);
    expect(shouldRedirectToOnboarding(null, 'app', false)).toBe(false);
  });

  it('keys the dashboard on onboarding_completed alone, as before', () => {
    expect(shouldRedirectToOnboarding(proFlagLagging, 'dashboard', false)).toBe(true);
    expect(shouldRedirectToOnboarding(onboardedFree, 'dashboard', false)).toBe(false);
    expect(shouldRedirectToOnboarding(pro, 'app', false)).toBe(false);
  });
});

describe('hasFinishedOnboarding', () => {
  it('is the flag, or being Pro under the paywall', () => {
    expect(hasFinishedOnboarding(onboardedFree, true)).toBe(true);
    expect(hasFinishedOnboarding(onboardedFree, false)).toBe(true);
    expect(hasFinishedOnboarding(proFlagLagging, true)).toBe(true);
    expect(hasFinishedOnboarding(proFlagLagging, false)).toBe(false);
    expect(hasFinishedOnboarding(newUser, true)).toBe(false);
    expect(hasFinishedOnboarding(null, true)).toBe(false);
  });
});

describe('safeNextPath / onboardingPath', () => {
  it('keeps in-app paths with their query', () => {
    expect(safeNextPath('/projects/abc')).toBe('/projects/abc');
    expect(safeNextPath('/projects/abc?welcome=1')).toBe('/projects/abc?welcome=1');
    expect(safeNextPath('/generate')).toBe('/generate');
  });

  it('drops anything that could leave the app or loop', () => {
    for (const bad of [
      '//evil.example',
      'https://evil.example/x',
      '/\\evil.example',
      'projects/abc',
      '/',
      '/onboarding',
      '/onboarding?next=/x',
      '/api/drafts',
      '/auth/login',
      '/success?session_id=x',
      '/checkout/canceled',
      `/${'a'.repeat(600)}`,
      null,
      undefined,
      42,
    ]) {
      expect(safeNextPath(bad)).toBeUndefined();
    }
  });

  it('builds the onboarding URL with an encoded next', () => {
    expect(onboardingPath('/projects/abc')).toBe('/onboarding?next=%2Fprojects%2Fabc');
    expect(onboardingPath('//evil.example')).toBe('/onboarding');
    expect(onboardingPath()).toBe('/onboarding');
  });
});

describe('onboardingPaywallApplies', () => {
  const since = '2026-11-25T00:00:00Z';

  it('is off when the switch is off', () => {
    expect(onboardingPaywallApplies('2027-01-01T00:00:00Z', false, since)).toBe(false);
  });

  it('spares accounts created before the paywall (tools imports never set onboarding_completed)', () => {
    expect(onboardingPaywallApplies('2026-10-01T12:00:00Z', true, since)).toBe(false);
  });

  it('applies to accounts created since, and to an unknown creation date', () => {
    expect(onboardingPaywallApplies('2026-11-25T00:00:00Z', true, since)).toBe(true);
    expect(onboardingPaywallApplies('2026-12-01T00:00:00Z', true, since)).toBe(true);
    expect(onboardingPaywallApplies(undefined, true, since)).toBe(true);
    expect(onboardingPaywallApplies('not a date', true, since)).toBe(true);
  });
});
