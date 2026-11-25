/**
 * The logic behind the OAuth consent page (app/oauth/consent) and its
 * approve/deny action (actions/oauth-consent.ts). Supabase Auth's OAuth 2.1
 * server sends the user to /oauth/consent?authorization_id=...; the page
 * shows who is asking for what and records the decision with
 * `supabase.auth.oauth.approveAuthorization` / `denyAuthorization`, which
 * answer with the client's redirect URL. Pure, so it is unit tested without
 * Next.js or Supabase.
 */

export const CONSENT_PATH = '/oauth/consent';

const AUTHORIZATION_ID_RE = /^[A-Za-z0-9_-]{8,128}$/;

export function isValidAuthorizationId(value: unknown): value is string {
  return typeof value === 'string' && AUTHORIZATION_ID_RE.test(value);
}

export function consentPath(authorizationId: string, error?: string): string {
  const params = new URLSearchParams({ authorization_id: authorizationId });
  if (error) params.set('error', error);
  return `${CONSENT_PATH}?${params.toString()}`;
}

/** The login page, coming back to this consent request afterwards. */
export function loginPathForConsent(authorizationId: string): string {
  return `/auth/login?next=${encodeURIComponent(consentPath(authorizationId))}`;
}

const SCOPE_LABELS: Record<string, string> = {
  openid: 'Confirm your Octree identity',
  email: 'See your email address',
  profile: 'See your name and profile picture',
  phone: 'See your phone number',
  offline_access: 'Stay connected until you disconnect it',
};

export interface ScopeDescription {
  scope: string;
  label: string;
}

/** `"openid email"` -> one line per scope, unknown scopes shown as they are. */
export function describeScopes(scope: string | null | undefined): ScopeDescription[] {
  const seen = new Set<string>();
  const out: ScopeDescription[] = [];
  for (const s of (scope ?? '').split(/\s+/)) {
    if (!s || seen.has(s)) continue;
    seen.add(s);
    out.push({ scope: s, label: SCOPE_LABELS[s] ?? s });
  }
  return out;
}

export interface RedirectDescription {
  /** Host (and port for loopback), shown on the page as the spec requires. */
  host: string;
  /** A local app (Claude Code, Cursor, ...) on this computer. */
  loopback: boolean;
}

export function describeRedirect(uri: string | null | undefined): RedirectDescription | null {
  if (!uri) return null;
  try {
    const url = new URL(uri);
    const loopback = url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]';
    return { host: loopback ? url.host : url.hostname, loopback };
  } catch {
    return null;
  }
}

/** Only http(s) URLs are followed after a decision (Supabase builds them from registered redirect URIs). */
export function isFollowableRedirect(url: unknown): url is string {
  if (typeof url !== 'string') return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch {
    return false;
  }
}

/** The fields of `getAuthorizationDetails` the page reads (supabase-js OAuthAuthorizationDetails | OAuthRedirect). */
export interface AuthorizationDetailsLike {
  authorization_id?: string;
  redirect_url?: string;
  redirect_uri?: string;
  scope?: string;
  client?: { id?: string; name?: string; uri?: string; logo_uri?: string };
}

export type ConsentView =
  | { kind: 'redirect'; url: string }
  | { kind: 'error'; message: string }
  | {
      kind: 'consent';
      authorizationId: string;
      clientName: string;
      clientHost: string | null;
      logoUri: string | null;
      scopes: ScopeDescription[];
      redirect: RedirectDescription | null;
    };

function hostOf(uri: string | undefined): string | null {
  if (!uri) return null;
  try {
    return new URL(uri).hostname || null;
  } catch {
    return null;
  }
}

/**
 * What the page shows for a `getAuthorizationDetails` answer: straight back
 * to the client when the user already consented (Supabase returns only a
 * redirect_url), an error, or the consent card.
 */
export function resolveConsentView(
  result: { data: AuthorizationDetailsLike | null; error: { message: string } | null },
  authorizationId: string
): ConsentView {
  if (result.error || !result.data) {
    return {
      kind: 'error',
      message:
        'This sign-in request was not found or has expired. Go back to the app you were connecting and start again.',
    };
  }
  const data = result.data;
  if (!data.authorization_id && isFollowableRedirect(data.redirect_url)) {
    return { kind: 'redirect', url: data.redirect_url };
  }
  const logo = data.client?.logo_uri;
  return {
    kind: 'consent',
    authorizationId: data.authorization_id ?? authorizationId,
    clientName: data.client?.name?.trim() || 'An application',
    clientHost: hostOf(data.client?.uri),
    logoUri: logo && /^https:\/\//.test(logo) ? logo : null,
    scopes: describeScopes(data.scope),
    redirect: describeRedirect(data.redirect_uri),
  };
}

export type ConsentDecision = 'approve' | 'deny';

export function parseDecision(value: unknown): ConsentDecision | null {
  return value === 'approve' || value === 'deny' ? value : null;
}

/** The supabase-js `auth.oauth` methods the decision needs. */
export interface ConsentOAuthApi {
  approveAuthorization(
    id: string,
    options?: { skipBrowserRedirect?: boolean }
  ): Promise<{ data: { redirect_url: string } | null; error: { message: string } | null }>;
  denyAuthorization(
    id: string,
    options?: { skipBrowserRedirect?: boolean }
  ): Promise<{ data: { redirect_url: string } | null; error: { message: string } | null }>;
}

/** Records the decision; the URL to send the browser to next. */
export async function runConsentDecision(
  oauth: ConsentOAuthApi,
  authorizationId: string,
  decision: ConsentDecision
): Promise<string> {
  const call = decision === 'approve' ? oauth.approveAuthorization : oauth.denyAuthorization;
  const { data, error } = await call.call(oauth, authorizationId, { skipBrowserRedirect: true });
  if (error || !isFollowableRedirect(data?.redirect_url)) {
    if (error) console.error(`[oauth-consent] ${decision} failed:`, error.message);
    return consentPath(authorizationId, 'decision_failed');
  }
  return data!.redirect_url;
}
