import { upsertUserUsage } from '@/lib/requests/user';
import { trackRedditEvent } from '@/lib/reddit-pixel';

/**
 * Finish onboarding on the free plan. Sets `onboarding_completed` the same way
 * the Stripe webhook does for paying users (an upsert on user_usage keyed by
 * user_id), then reports the sign-up to Reddit so free acquisition stays
 * measurable. The flag is written first; tracking never blocks or fails it.
 */
export async function completeFreeOnboarding(
  userId: string,
  email?: string | null
): Promise<void> {
  await upsertUserUsage(userId, { onboarding_completed: true });
  trackRedditEvent('SignUp', email ?? undefined);
}
