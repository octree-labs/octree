import { type NextRequest } from 'next/server';
import { updateSession } from '@/lib/supabase/middleware';

export async function middleware(request: NextRequest) {
  // Do not force auth redirects for API routes; route will return 401 JSON
  const isApiRoute = request.nextUrl.pathname.startsWith('/api/');
  if (isApiRoute) {
    // Still refresh session cookies via updateSession (no redirect on missing user)
    return await updateSession(request);
  }

  return await updateSession(request);
}

// The PostHog relay (lib/analytics/posthog-proxy.ts, rewritten in
// next.config.ts) must not pay for a Supabase session refresh on every event
// batch, nor be redirected to /auth/login for signed-out visitors.
// Matchers must be static literals, so the prefix is repeated here.
export const config = {
  matcher: [
    '/((?!_next/static|relay-o7(?:/|$)|_next/image|favicon.ico|robots\\.txt|sitemap\\.xml|llms\\.txt|assets/|logos/|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
