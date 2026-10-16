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

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|assets/|logos/|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
