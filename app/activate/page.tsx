import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { AlertTriangle, Check, CheckCircle2 } from 'lucide-react';
import { decideDeviceAuthorization } from '@/actions/device-activate';
import { OctreeLogo, OctreeWordmark } from '@/components/icons/octree-logo';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { API_FREE_DAILY_COMPILES, API_PRO_DAILY_COMPILES } from '@/data/constants';
import { MAX_ACTIVE_API_KEYS } from '@/lib/api/keys';
import { allowActivateAttempt } from '@/lib/device/activate-limit';
import {
  ACTIVATE_PATH,
  type ActivateError,
  deviceKeyName,
  loginPathForActivate,
  normalizeUserCode,
  parseActivateError,
} from '@/lib/device/codes';
import { findActivatableRequest, type DeviceRow } from '@/lib/device/flow';
import { createDeviceStore } from '@/lib/device/store';
import { createClient } from '@/lib/supabase/server';

/**
 * /activate: where a user approves a headless agent's device authorization
 * request (POST /api/v1/device/code hands the agent this URL with ?code=).
 * Signed-out visitors go to the login page (sign-up included) and come back.
 * Outside the dashboard/editor layouts on purpose, so the onboarding paywall
 * (lib/onboarding/paywall-gate*) never intercepts it: free accounts can
 * connect agents too.
 */

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Connect an agent | Octree',
  robots: { index: false, follow: false },
};

interface PageProps {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

const SETTINGS_KEYS_PATH = '/settings/account#api-keys';

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
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

function Banner({ error }: { error: ActivateError }) {
  const messages: Record<ActivateError, React.ReactNode> = {
    not_found: 'That code is not valid or has expired. Check the code your agent shows, or start again from the agent.',
    invalid: 'Enter the 8-letter code your agent shows, like WDJB-MJHT.',
    rate_limited: 'Too many attempts. Wait a few minutes and try again.',
    failed: 'That didn’t go through. Try again, or restart the connection from the agent.',
    key_limit: (
      <>
        You already have {MAX_ACTIVE_API_KEYS} active API keys, the most an account can hold.{' '}
        <Link href={SETTINGS_KEYS_PATH} className="font-medium underline underline-offset-4">
          Revoke one in Settings
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

function DoneCard({ approved }: { approved: boolean }) {
  return (
    <Shell>
      <Card>
        <CardHeader className="space-y-3">
          {approved ? <CheckCircle2 className="h-8 w-8 text-green-600" /> : null}
          <CardTitle className="text-xl">{approved ? 'Agent connected' : 'Request denied'}</CardTitle>
          <CardDescription>
            {approved
              ? 'Go back to your agent or terminal: it picks up its API key within a few seconds. You can close this page.'
              : 'Nothing was shared with the agent. You can close this page.'}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2 sm:flex-row">
          {approved ? (
            <Button asChild variant="outline" className="w-full sm:flex-1">
              <Link href={SETTINGS_KEYS_PATH}>Manage API keys</Link>
            </Button>
          ) : null}
          <Button asChild variant="outline" className="w-full sm:flex-1">
            <Link href="/">Go to Octree</Link>
          </Button>
        </CardContent>
      </Card>
    </Shell>
  );
}

function EnterCodeCard({ code, error, email }: { code: string; error: ActivateError | null; email: string }) {
  return (
    <Shell>
      <Card>
        <CardHeader>
          <CardTitle className="text-xl">Connect an agent</CardTitle>
          <CardDescription>Enter the code shown by the agent or command-line tool you are connecting.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {error ? <Banner error={error} /> : null}
          <form action={ACTIVATE_PATH} method="get" className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="code">Code</Label>
              <Input
                id="code"
                name="code"
                defaultValue={code}
                placeholder="WDJB-MJHT"
                autoComplete="off"
                autoCapitalize="characters"
                spellCheck={false}
                maxLength={16}
                className="font-mono text-lg tracking-widest uppercase"
                required
              />
            </div>
            <Button type="submit" variant="gradient" className="w-full">
              Continue
            </Button>
          </form>
          <p className="text-sm text-neutral-600">
            Signed in as <span className="font-medium text-neutral-900">{email}</span>.
          </p>
        </CardContent>
      </Card>
    </Shell>
  );
}

function minutesLeft(row: DeviceRow, now: number): number {
  return Math.max(1, Math.ceil((Date.parse(row.expires_at) - now) / 60_000));
}

function ConsentCard({
  row,
  error,
  email,
  now,
}: {
  row: DeviceRow;
  error: ActivateError | null;
  email: string;
  now: number;
}) {
  const name = row.client_name ?? 'An agent';
  return (
    <Shell>
      <Card>
        <CardHeader className="space-y-3">
          <CardTitle className="text-xl">Connect {name} to your Octree account?</CardTitle>
          <CardDescription>
            It gets its own API key, which can compile LaTeX through the Octree API and MCP server, using your
            plan&apos;s daily quota: {API_FREE_DAILY_COMPILES} compiles a day on Free,{' '}
            {API_PRO_DAILY_COMPILES.toLocaleString('en-US')} on Pro. It cannot see or change your projects.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {error ? <Banner error={error} /> : null}

          <ul className="space-y-1.5">
            {[
              'Compile LaTeX documents to PDF',
              'Check documents for LaTeX errors',
              'See your plan and today’s API usage',
            ].map((label) => (
              <li key={label} className="flex items-start gap-2 text-sm text-neutral-700">
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-neutral-500" />
                <span>{label}</span>
              </li>
            ))}
          </ul>

          <form action={decideDeviceAuthorization} className="space-y-4">
            <input type="hidden" name="request_id" value={row.id} />
            <div className="space-y-2">
              <Label htmlFor="user_code">Code shown by your agent</Label>
              <Input
                id="user_code"
                name="user_code"
                defaultValue={row.user_code}
                autoComplete="off"
                autoCapitalize="characters"
                spellCheck={false}
                maxLength={16}
                className="font-mono text-lg tracking-widest uppercase"
                required
              />
              <p className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>
                  Check that this matches the code your agent shows. Only approve a connection you just started
                  yourself, never a code someone sent you.
                </span>
              </p>
            </div>

            <p className="text-sm text-neutral-600">
              Signed in as <span className="font-medium text-neutral-900">{email}</span>.{' '}
              <Link href={loginPathForActivate(row.user_code)} className="underline underline-offset-4">
                Use a different account
              </Link>
            </p>

            <div className="flex flex-col gap-2 sm:flex-row-reverse">
              <Button type="submit" name="decision" value="approve" variant="gradient" className="w-full sm:flex-1">
                Approve
              </Button>
              <Button type="submit" name="decision" value="deny" variant="outline" className="w-full sm:flex-1">
                Deny
              </Button>
            </div>
          </form>

          <p className="text-xs text-neutral-500">
            The key is listed in{' '}
            <Link href={SETTINGS_KEYS_PATH} className="underline underline-offset-4">
              Settings
            </Link>{' '}
            as &ldquo;{deviceKeyName(row.client_name)}&rdquo;; revoke it there at any time. This request expires in{' '}
            {minutesLeft(row, now)} min.
          </p>
        </CardContent>
      </Card>
    </Shell>
  );
}

export default async function ActivatePage({ searchParams }: PageProps) {
  const params = await searchParams;
  const rawCode = first(params.code)?.slice(0, 32) ?? '';
  const userCode = normalizeUserCode(rawCode);
  const done = first(params.done);
  let error = parseActivateError(first(params.error));

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(loginPathForActivate(userCode));

  if (done === 'approved' || done === 'denied') return <DoneCard approved={done === 'approved'} />;

  const email = user.email ?? 'your account';
  if (!rawCode) return <EnterCodeCard code="" error={error} email={email} />;
  if (!userCode) return <EnterCodeCard code={rawCode} error="invalid" email={email} />;
  if (!allowActivateAttempt(user.id)) return <EnterCodeCard code={userCode} error="rate_limited" email={email} />;

  const now = Date.now();
  let row: DeviceRow | null = null;
  try {
    row = await findActivatableRequest(createDeviceStore(), userCode, now);
  } catch (lookupError) {
    console.error('[activate] lookup failed:', lookupError instanceof Error ? lookupError.message : 'unknown error');
    return <EnterCodeCard code={userCode} error="failed" email={email} />;
  }
  if (!row) return <EnterCodeCard code={userCode} error="not_found" email={email} />;

  // A not_found from the action for a code that does name a live request
  // means the code was edited on the page: just show that request.
  if (error === 'not_found' || error === 'invalid') error = null;
  return <ConsentCard row={row} error={error} email={email} now={now} />;
}
