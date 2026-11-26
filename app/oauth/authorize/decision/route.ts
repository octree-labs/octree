import { requestOrigin } from '@/lib/api/origin';
import { AnalyticsEvents } from '@/lib/analytics/events';
import { buildClientRedirect, pickAuthorizeParams, validateAuthorizeRequest } from '@/lib/oauth/authorize';
import {
  allowConsentDecision,
  authorizePath,
  consentSecret,
  isSameOriginPost,
  loginPathForAuthorize,
  verifyConsentToken,
} from '@/lib/oauth/consent';
import { issueAuthorizationCode } from '@/lib/oauth/flow';
import { createOAuthStore, resolveClient } from '@/lib/oauth/store';
import { captureServerEventAfterResponse, captureServerExceptionAfterResponse } from '@/lib/posthog-server';
import { createClient } from '@/lib/supabase/server';

/**
 * POST /oauth/authorize/decision: the Approve / Deny form of the consent
 * screen (app/oauth/authorize/page.tsx). A route handler rather than a
 * server action so the answer is a plain 303 to the client's redirect_uri,
 * which may be an app scheme (cursor://, vscode://) or a loopback port.
 *
 * Re-validates every authorization parameter (the form is user-editable),
 * requires a same-origin POST and the page's signed consent token
 * (lib/oauth/consent.ts), then:
 *   approve -> 303 redirect_uri?code=...&state=...&iss=...
 *   deny    -> 303 redirect_uri?error=access_denied&state=...&iss=...
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function seeOther(location: string): Response {
  return new Response(null, { status: 303, headers: { Location: location, 'Cache-Control': 'no-store' } });
}

export async function GET(request: Request) {
  return seeOther(new URL('/', request.url).toString());
}

export async function POST(request: Request) {
  const origin = requestOrigin(request);
  const local = (path: string) => new URL(path, origin).toString();
  if (!isSameOriginPost(request.headers, origin)) {
    return new Response('Cross-site request refused.', { status: 403, headers: { 'Content-Type': 'text/plain' } });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return new Response('Bad request.', { status: 400, headers: { 'Content-Type': 'text/plain' } });
  }
  const params = pickAuthorizeParams(form);
  const decision = form.get('decision');

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return seeOther(local(loginPathForAuthorize(params)));

  const secret = consentSecret();
  if (!secret || !verifyConsentToken(secret, form.get('consent_token'), user.id, params)) {
    // Expired page, another account signed in meanwhile, or edited fields: show the screen again.
    return seeOther(local(authorizePath(params, { octree_error: 'expired' })));
  }
  if (decision !== 'approve' && decision !== 'deny') return seeOther(local(authorizePath(params)));
  if (!allowConsentDecision(user.id)) return seeOther(local(authorizePath(params, { octree_error: 'rate_limited' })));

  try {
    const validation = await validateAuthorizeRequest(params, { origin, resolveClient: (id) => resolveClient(id) });
    if (!validation.ok) {
      return validation.kind === 'redirect' ? seeOther(validation.location) : seeOther(local(authorizePath(params)));
    }
    const { request: valid } = validation;
    const clientProps = {
      client_kind: valid.client.kind,
      client_name: valid.client.client_name,
      client_host: valid.client.metadata_host,
    };

    if (decision === 'deny') {
      captureServerEventAfterResponse(user.id, AnalyticsEvents.OAUTH_DENIED, clientProps);
      return seeOther(
        buildClientRedirect(
          valid.redirectUri,
          { error: 'access_denied', error_description: 'The user denied the request.', state: valid.state },
          origin
        )
      );
    }

    const issued = await issueAuthorizationCode(createOAuthStore(), { request: valid, userId: user.id, now: Date.now() });
    if (!issued.ok) return seeOther(local(authorizePath(params, { octree_error: 'grant_limit' })));
    captureServerEventAfterResponse(user.id, AnalyticsEvents.OAUTH_AUTHORIZED, { ...clientProps, scope: valid.scope });
    return seeOther(buildClientRedirect(valid.redirectUri, { code: issued.code, state: valid.state }, origin));
  } catch (error) {
    console.error('[oauth/authorize/decision] failed:', error instanceof Error ? error.message : 'unknown error');
    captureServerExceptionAfterResponse(error, { route: 'oauth/authorize/decision', distinctId: user.id });
    return seeOther(local(authorizePath(params, { octree_error: 'failed' })));
  }
}
