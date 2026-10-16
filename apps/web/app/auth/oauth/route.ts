import { NextResponse } from 'next/server';
import { buildRedirectUrl } from '@/lib/auth/redirect';
import { createClient } from '@/lib/supabase/server';

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  const nextParam = searchParams.get('next') ?? '/';
  const next = nextParam.startsWith('/') ? nextParam : '/';

  if (code) {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error && data.user) {
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
