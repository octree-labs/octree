import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { AlertTriangle, Check } from 'lucide-react';
import { decideOAuthConsent } from '@/actions/oauth-consent';
import { OctreeLogo, OctreeWordmark } from '@/components/icons/octree-logo';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { createClient } from '@/lib/supabase/server';
import { isValidAuthorizationId, loginPathForConsent, resolveConsentView } from '@/lib/oauth/consent';

/**
 * OAuth consent for Octree's MCP server and API (Supabase Auth OAuth 2.1
 * server, "Authorization Path" = /oauth/consent). Supabase redirects here
 * with ?authorization_id=...; signed-out visitors go to the login page and
 * come back. Outside the dashboard/editor layouts on purpose, so the
 * onboarding paywall (lib/onboarding/paywall-gate*) never intercepts it.
 */

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Authorize access | Octree',
  robots: { index: false, follow: false },
};

interface PageProps {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-svh w-full flex-col items-center justify-center p-6 md:p-10">
      <div className="mb-6 flex items-center gap-2">
        <OctreeLogo className="h-6 w-6" />
        <OctreeWordmark className="text-lg" />
      </div>
      <div className="w-full max-w-md">{children}</div>
    </div>
  );
}

function ErrorCard({ message }: { message: string }) {
  return (
    <Shell>
      <Card>
        <CardHeader>
          <CardTitle className="text-xl">Can&apos;t continue</CardTitle>
          <CardDescription>{message}</CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild variant="outline" className="w-full">
            <Link href="/">Go to Octree</Link>
          </Button>
        </CardContent>
      </Card>
    </Shell>
  );
}

export default async function OAuthConsentPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const authorizationId = params.authorization_id;
  if (!isValidAuthorizationId(authorizationId)) {
    return <ErrorCard message="This page needs an authorization request. Start the connection again from the app you are connecting." />;
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(loginPathForConsent(authorizationId));

  const view = resolveConsentView(await supabase.auth.oauth.getAuthorizationDetails(authorizationId), authorizationId);
  if (view.kind === 'redirect') redirect(view.url);
  if (view.kind === 'error') return <ErrorCard message={view.message} />;

  const failed = params.error === 'decision_failed';

  return (
    <Shell>
      <Card>
        <CardHeader className="space-y-3">
          {view.logoUri ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={view.logoUri} alt="" className="h-10 w-10 rounded-md border object-contain" />
          ) : null}
          <CardTitle className="text-xl">
            {view.clientName} wants to use your Octree account
          </CardTitle>
          <CardDescription>
            It will be able to compile LaTeX documents with Octree and use your plan&apos;s daily compile quota.
            {view.clientHost ? (
              <>
                {' '}
                App website: <span className="font-medium text-neutral-900">{view.clientHost}</span>.
              </>
            ) : null}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {failed ? (
            <p className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              That didn&apos;t go through. The request may have expired; try again, or restart the connection from the app.
            </p>
          ) : null}

          {view.scopes.length > 0 ? (
            <div className="space-y-2">
              <p className="text-sm font-medium">It is asking to:</p>
              <ul className="space-y-1.5">
                {view.scopes.map((s) => (
                  <li key={s.scope} className="flex items-start gap-2 text-sm text-neutral-700">
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-neutral-500" />
                    <span>{s.label}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {view.redirect ? (
            <div className="space-y-1 text-sm text-neutral-600">
              <p>
                You will be sent back to <span className="font-medium text-neutral-900">{view.redirect.host}</span>.
              </p>
              {view.redirect.loopback ? (
                <p className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-amber-800">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>
                    This is an app running on your computer (such as Claude Code or Cursor). Only approve if you just
                    started this connection yourself.
                  </span>
                </p>
              ) : null}
            </div>
          ) : null}

          <p className="text-sm text-neutral-600">
            Signed in as <span className="font-medium text-neutral-900">{user.email ?? 'your account'}</span>.{' '}
            <Link href={loginPathForConsent(view.authorizationId)} className="underline underline-offset-4">
              Use a different account
            </Link>
          </p>

          <form action={decideOAuthConsent} className="flex flex-col gap-2 sm:flex-row-reverse">
            <input type="hidden" name="authorization_id" value={view.authorizationId} />
            <Button type="submit" name="decision" value="approve" variant="gradient" className="w-full sm:flex-1">
              Approve
            </Button>
            <Button type="submit" name="decision" value="deny" variant="outline" className="w-full sm:flex-1">
              Deny
            </Button>
          </form>

          <p className="text-xs text-neutral-500">
            You can disconnect it at any time from the app you are connecting.
          </p>
        </CardContent>
      </Card>
    </Shell>
  );
}
