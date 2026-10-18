import { NextResponse } from 'next/server';
import { buildRedirectUrl } from '@/lib/auth/redirect';
import { createClient } from '@/lib/supabase/server';
import { pendingDraftFromCookieHeader } from '@/lib/import/pending-draft';
import { AnalyticsEvents } from '@/lib/analytics/events';
import { captureServerEventAfterResponse } from '@/lib/posthog-server';

/** An OAuth account created within this window of the callback is a sign-up. */
const NEW_ACCOUNT_WINDOW_MS = 5 * 60 * 1000;

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  const nextParam = searchParams.get('next') ?? '/';
  let next = nextParam.startsWith('/') ? nextParam : '/';

  // A draft posted from tools.useoctree.com is still waiting: finish the
  // import instead of landing on the dashboard. The import route reads the
  // id from the cookie and clears it.
  if (next === '/' && pendingDraftFromCookieHeader(request.headers.get('cookie'))) {
    next = '/import';
  }

  if (code) {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error && data.user) {
      // The email form reports its own sign-ups (components/auth/signup-form.tsx);
      // OAuth accounts only pass through here, so a freshly created one is a sign-up.
      const createdAt = Date.parse(data.user.created_at ?? '');
      if (Number.isFinite(createdAt) && Date.now() - createdAt < NEW_ACCOUNT_WINDOW_MS) {
        captureServerEventAfterResponse(data.user.id, AnalyticsEvents.SIGNUP_COMPLETED, {
          provider: data.user.app_metadata?.provider ?? 'oauth',
        });
      }

      // Check if user has already completed onboarding
      type UsageRecord = {
        onboarding_completed: boolean | null;
      };
      
      const { data: existingUsage } = await supabase
        .from('user_usage')
        .select('onboarding_completed')
        .eq('user_id', data.user.id)
        .maybeSingle<UsageRecord>();

      // Only auto-complete onboarding if:
      // 1. They haven't completed it yet, AND
      // 2. They're coming from Tools (deep link to editor or referer is tools domain)
      const isFromTools = 
        next.includes('/projects/') || 
        next.includes('/files/') ||
        request.headers.get('referer')?.includes('tools.useoctree.com');

      if (!existingUsage?.onboarding_completed && isFromTools) {
        await supabase
          .from('user_usage')
          // @ts-ignore - Supabase type generation issue
          .upsert({
            user_id: data.user.id,
            onboarding_completed: true,
            referral_source: 'tools',
          }, {
            onConflict: 'user_id',
          });
      }
      
      const destination = buildRedirectUrl(request.headers, origin, next);
      return NextResponse.redirect(destination, { status: 303 });
    }
  }

  return NextResponse.redirect(`${origin}/auth/error`);
}
