import { ONBOARDING_PAYWALL_REQUIRED } from '@/data/constants';

/**
 * Who has to go (back) to /onboarding, under the onboarding paywall
 * (data/constants.ts ONBOARDING_PAYWALL_REQUIRED). Pure and browser-safe:
 * the dashboard, the project and generate layouts and the onboarding page
 * all decide with these functions.
 */

/** The user_usage columns the rule reads. A missing row is a brand-new user. */
export interface OnboardingGateUsage {
  is_pro?: boolean | null;
  onboarding_completed?: boolean | null;
}

/**
 * - `dashboard`: `/`. It has always sent a user whose onboarding is not
 *   completed to /onboarding.
 * - `app`: the editor (/projects/*) and /generate. Without the paywall these
 *   never checked onboarding (a draft from tools.useoctree.com lands in the
 *   editor straight away).
 */
export type OnboardingGateSurface = 'dashboard' | 'app';

/**
 * Whether the user has finished onboarding: the flag (set by the Stripe
 * webhook for a paid subscription, and by the free path when the paywall is
 * off), or, under the paywall, being Pro already (the webhook writes both;
 * this keeps a paying user out of the plan step if the flag lags).
 */
export function hasFinishedOnboarding(
  usage: OnboardingGateUsage | null | undefined,
  paywallRequired: boolean = ONBOARDING_PAYWALL_REQUIRED
): boolean {
  if (usage?.onboarding_completed) return true;
  return paywallRequired && !!usage?.is_pro;
}

/**
 * Whether this page must send the user to /onboarding.
 *
 * Users with onboarding_completed = true are never redirected, paywall or
 * not, so nobody who was already let in (free or Pro) is locked out. With
 * the paywall off this is exactly the old behaviour: only the dashboard
 * redirects.
 */
export function shouldRedirectToOnboarding(
  usage: OnboardingGateUsage | null | undefined,
  surface: OnboardingGateSurface,
  paywallRequired: boolean = ONBOARDING_PAYWALL_REQUIRED
): boolean {
  if (hasFinishedOnboarding(usage, paywallRequired)) return false;
  if (paywallRequired) return true;
  return surface === 'dashboard';
}

const NEXT_PATH_MAX_LENGTH = 512;
const NEXT_PATH_BASE = 'https://next-path.invalid';
const NEXT_PATH_BLOCKED_PREFIXES = ['/api/', '/auth/', '/checkout/', '/success', '/onboarding'];

/**
 * A same-origin in-app path to continue to after onboarding (the project a
 * tools draft was imported into, /generate), or undefined. Anything that
 * could leave the app, an API/auth/checkout route, /onboarding itself, or an
 * over-long value is dropped.
 */
export function safeNextPath(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length > NEXT_PATH_MAX_LENGTH) return undefined;
  if (!value.startsWith('/') || value.startsWith('//') || value.includes('\\')) return undefined;
  if (/[\u0000-\u001f]/.test(value)) return undefined;
  let url: URL;
  try {
    url = new URL(value, NEXT_PATH_BASE);
  } catch {
    return undefined;
  }
  if (url.origin !== NEXT_PATH_BASE) return undefined;
  if (url.pathname === '/') return undefined;
  if (NEXT_PATH_BLOCKED_PREFIXES.some((prefix) => url.pathname.startsWith(prefix))) return undefined;
  return `${url.pathname}${url.search}`;
}

/** `/onboarding`, carrying the page to come back to after paying. */
export function onboardingPath(next?: string): string {
  const safe = safeNextPath(next);
  return safe ? `/onboarding?next=${encodeURIComponent(safe)}` : '/onboarding';
}
