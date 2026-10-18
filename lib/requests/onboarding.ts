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
export async function completeFreeOnboarding(user: OnboardingUser): Promise<void> {
  await upsertUserUsage(user.id, { onboarding_completed: true });
  track(AnalyticsEvents.ONBOARDING_COMPLETED, { plan: 'free' });
  if (!isSignUpAlreadyTracked(user)) {
    trackRedditEvent('SignUp', user.email ?? undefined);
  }
}
