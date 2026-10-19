import type { User } from '@supabase/supabase-js';
import { upsertUserUsage } from '@/lib/requests/user';
import { trackRedditEvent } from '@/lib/reddit-pixel';
import { AnalyticsEvents } from '@/lib/analytics/events';
import { track } from '@/lib/analytics/track';

type OnboardingUser = Pick<User, 'id' | 'email'> & {
  app_metadata?: Partial<User['app_metadata']>;
};

/**
 * The email sign-up form (components/auth/signup-form.tsx) already reports
 * `SignUp` to Reddit when the account is created. OAuth sign-ups never pass
 * through that form, so they are reported here instead; email sign-ups are not
 * reported twice. `app_metadata.provider` is the provider the account was
 * created with.
 */
export function isSignUpAlreadyTracked(user: OnboardingUser): boolean {
  return user.app_metadata?.provider === 'email';
}

/**
 * Finish onboarding on the free plan. Sets `onboarding_completed` the same way
 * the Stripe webhook does for paying users (an upsert on user_usage keyed by
 * user_id), then reports the sign-up to Reddit (unless the sign-up form
 * already did) so free acquisition stays measurable. The flag is written
 * first; tracking never blocks or fails it.
 */
export async function completeFreeOnboarding(
  user: OnboardingUser,
  details: { referralSource?: string | null } = {}
): Promise<void> {
  await upsertUserUsage(user.id, { onboarding_completed: true });
  // The answer is also a person property via identify, but person
  // properties are a snapshot; carrying it on the event lets the
  // acquisition breakdown be read for any date range.
  track(AnalyticsEvents.ONBOARDING_COMPLETED, {
    plan: 'free',
    ...(details.referralSource ? { referral_source: details.referralSource } : {}),
  });
  if (!isSignUpAlreadyTracked(user)) {
    trackRedditEvent('SignUp', user.email ?? undefined);
  }
}
