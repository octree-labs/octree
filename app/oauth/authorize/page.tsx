import type { Metadata } from 'next';
import Link from 'next/link';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { AlertTriangle, Check, ShieldCheck } from 'lucide-react';
import { OctreeLogo, OctreeWordmark } from '@/components/icons/octree-logo';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { API_FREE_DAILY_COMPILES, API_PRO_DAILY_COMPILES } from '@/data/constants';
import {
  AUTHORIZE_PARAM_NAMES,
  pickAuthorizeParams,
  validateAuthorizeRequest,
  type AuthorizeParams,
  type ValidAuthorizeRequest,
} from '@/lib/oauth/authorize';
import { clientDisplayName } from '@/lib/oauth/clients';
import { consentSecret, createConsentToken, loginPathForAuthorize, originFromHeaders } from '@/lib/oauth/consent';
import { AUTHORIZE_DECISION_PATH, MAX_ACTIVE_OAUTH_GRANTS } from '@/lib/oauth/metadata';
import { redirectDisplay } from '@/lib/oauth/redirect-uri';
import { createOAuthStore, resolveClient } from '@/lib/oauth/store';
import { createClient } from '@/lib/supabase/server';

/**
 * /oauth/authorize: the "Allow <app>" screen of Octree's OAuth 2.1
 * authorization server (MCP clients: Claude, ChatGPT, Cursor, VS Code).
 * Signed-out visitors go to the login page (sign-up included) and come back.
 * Outside the dashboard/editor layouts on purpose, so the onboarding paywall
 * (lib/onboarding/paywall-gate*) never intercepts it: free accounts can
 * connect apps too. Never framed (next.config.ts).
 *
 * Approve / Deny post to /oauth/authorize/decision, which validates
 * everything again and redirects back to the app.
 */

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Connect an app | Octree',
  robots: { index: false, follow: false },
};

interface PageProps {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

const SETTINGS_PATH = '/settings/account#connected-apps';

type ScreenError = 'expired' | 'rate_limited' | 'grant_limit' | 'failed';

function parseScreenError(value: unknown): ScreenError | null {
  return value === 'expired' || value === 'rate_limited' || value === 'grant_limit' || value === 'failed' ? value : null;
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

function ErrorCard({ title, description }: { title: string; description: string }) {
  return (
    <Shell>
      <Card>
        <CardHeader className="space-y-3">
          <AlertTriangle className="h-8 w-8 text-amber-600" />
          <CardTitle className="text-xl">{title}</CardTitle>
          <CardDescription>{description}</CardDescription>
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

function Banner({ error }: { error: ScreenError }) {
  const messages: Record<ScreenError, React.ReactNode> = {
    expired: 'This page expired or you switched accounts. Check the details and choose again.',
    rate_limited: 'Too many attempts. Wait a few minutes and try again.',
    failed: 'That didn’t go through. Try again, or restart the connection from the app.',
    grant_limit: (
      <>
        You already have {MAX_ACTIVE_OAUTH_GRANTS} connected apps, the most an account can hold.{' '}
        <Link href={SETTINGS_PATH} className="font-medium underline underline-offset-4">
          Disconnect one in Settings
        </Link>
        , then approve again.
      </>
    ),
  };
  return (
    <p className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700" role="alert">
      {messages[error]}
    </p>
  );
}

function ConsentCard({
  request,
  params,
  token,
  email,
  error,
  atLimit,
}: {
  request: ValidAuthorizeRequest;
  params: AuthorizeParams;
  token: string;
  email: string;
  error: ScreenError | null;
  atLimit: boolean;
}) {
  const { client } = request;
  const name = clientDisplayName(client);
  const destination = redirectDisplay(request.redirectUri);
  const shownError = error ?? (atLimit ? 'grant_limit' : null);

  return (
    <Shell>
      <Card>
        <CardHeader className="space-y-3">
          <CardTitle className="text-xl">Allow {name} to use your Octree account?</CardTitle>
          {client.kind === 'cimd' ? (
            <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
              <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-green-600" />
              <span>
                App details published by <span className="font-medium text-neutral-800">{client.metadata_host}</span>.
                {client.client_name ? <> The name &ldquo;{client.client_name}&rdquo; is set by that site.</> : null}
              </span>
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">
              &ldquo;{name}&rdquo; is the name the app gave itself when it registered; Octree has not verified it. Only
              continue if you just started connecting Octree from this app.
            </p>
          )}
          <CardDescription>
            It can compile LaTeX through the Octree API and MCP server, using your plan&apos;s daily quota (
            {API_FREE_DAILY_COMPILES} compiles a day on Free, {API_PRO_DAILY_COMPILES.toLocaleString('en-US')} on Pro).
            It cannot read or change your projects.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {shownError ? <Banner error={shownError} /> : null}

          <ul className="space-y-1.5">
            {['Compile LaTeX documents to PDF', 'Check documents for LaTeX errors', 'See your plan and today’s API usage'].map(
              (label) => (
                <li key={label} className="flex items-start gap-2 text-sm text-neutral-700">
                  <Check className="mt-0.5 h-4 w-4 shrink-0 text-neutral-500" />
                  <span>{label}</span>
                </li>
              )
            )}
          </ul>

          <div className="rounded-md border border-neutral-200 bg-neutral-50 p-3 text-sm text-neutral-700">
            After you approve, you go back to{' '}
            <span className="font-mono font-medium text-neutral-900 break-all">{destination.label}</span>
            {destination.loopback ? ' (a program on this computer)' : destination.app ? ' (an app on this device)' : ''}.
          </div>

          {request.loopbackOnly ? (
            <p className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                This app receives access through a local address, which any program on your computer could use. Only
                approve if you just started this from an app you trust, such as your editor or terminal.
              </span>
            </p>
          ) : null}

          <form action={AUTHORIZE_DECISION_PATH} method="post" className="space-y-4">
            {AUTHORIZE_PARAM_NAMES.map((paramName) =>
              params[paramName] ? <input key={paramName} type="hidden" name={paramName} value={params[paramName]} /> : null
            )}
            <input type="hidden" name="consent_token" value={token} />

            <p className="text-sm text-neutral-600">
              Signed in as <span className="font-medium text-neutral-900">{email}</span>.{' '}
              <Link href={loginPathForAuthorize(params)} className="underline underline-offset-4">
                Use a different account
              </Link>
            </p>

            <div className="flex flex-col gap-2 sm:flex-row-reverse">
              <Button
                type="submit"
                name="decision"
                value="approve"
                variant="gradient"
                className="w-full sm:flex-1"
                disabled={atLimit}
              >
                Approve
              </Button>
              <Button type="submit" name="decision" value="deny" variant="outline" className="w-full sm:flex-1">
                Deny
              </Button>
            </div>
          </form>

          <p className="text-xs text-neutral-500">
            Disconnect it any time in{' '}
            <Link href={SETTINGS_PATH} className="underline underline-offset-4">
              Settings &gt; Connected apps
            </Link>
            .
          </p>
        </CardContent>
      </Card>
    </Shell>
  );
}

export default async function AuthorizePage({ searchParams }: PageProps) {
  const raw = await searchParams;
  const params = pickAuthorizeParams(raw);
  const screenError = parseScreenError(Array.isArray(raw.octree_error) ? raw.octree_error[0] : raw.octree_error);

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  // Signed in first: the client lookup may fetch a metadata document, and
  // anonymous visitors should not be able to make the server fetch URLs.
  if (!user) redirect(loginPathForAuthorize(params));

  const origin = originFromHeaders(await headers());
  const secret = consentSecret();
  if (!secret) {
    console.error('[oauth/authorize] no OAUTH_CONSENT_SECRET, DEVICE_FLOW_SECRET or SUPABASE_SERVICE_ROLE_KEY');
    return <ErrorCard title="Connections are unavailable" description="Octree cannot accept connections right now. Try again later." />;
  }

  let validation: Awaited<ReturnType<typeof validateAuthorizeRequest>>;
  let activeGrants = 0;
  try {
    validation = await validateAuthorizeRequest(params, { origin, resolveClient: (id) => resolveClient(id) });
    if (validation.ok) activeGrants = await createOAuthStore().countActiveGrants(user.id);
  } catch (error) {
    console.error('[oauth/authorize] failed:', error instanceof Error ? error.message : 'unknown error');
    return <ErrorCard title="Something went wrong" description="Octree could not load this request. Try again from the app." />;
  }
  if (!validation.ok) {
    if (validation.kind === 'redirect') redirect(validation.location);
    return <ErrorCard title={validation.title} description={validation.description} />;
  }

  return (
    <ConsentCard
      request={validation.request}
      params={params}
      token={createConsentToken(secret, user.id, params)}
      email={user.email ?? 'your account'}
      error={screenError}
      atLimit={activeGrants >= MAX_ACTIVE_OAUTH_GRANTS}
    />
  );
}
