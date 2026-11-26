import { apiPreflight } from '@/lib/api/http';
import { AnalyticsEvents } from '@/lib/analytics/events';
import { clientIp, createRateLimiter } from '@/lib/import/rate-limit';
import { parseRegistrationRequest } from '@/lib/oauth/clients';
import { oauthError, oauthJson, readOAuthBody } from '@/lib/oauth/http';
import { redirectDisplay } from '@/lib/oauth/redirect-uri';
import { insertDcrClient } from '@/lib/oauth/store';
import { captureServerEventAfterResponse, captureServerExceptionAfterResponse } from '@/lib/posthog-server';

/**
 * POST /oauth/register: OAuth 2.0 Dynamic Client Registration (RFC 7591)
 * for MCP clients that do not use a Client ID Metadata Document (Cursor,
 * VS Code, ChatGPT, older Claude builds).
 *
 * Public clients only: token_endpoint_auth_method must be "none" (or
 * absent) and no secret is issued. redirect_uris (1 to 10) must be https,
 * http on a loopback host, or an app scheme (lib/oauth/redirect-uri.ts).
 * client_name is cut to 60 characters. Registering grants nothing by
 * itself: every connection still needs the user's consent.
 *
 * 30 registrations per IP per hour (per process).
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_BODY_BYTES = 16 * 1024;

const globalForRegister = globalThis as unknown as { __octreeOAuthRegisterLimiter__?: ReturnType<typeof createRateLimiter> };
const limiter = (globalForRegister.__octreeOAuthRegisterLimiter__ ??= createRateLimiter({ limit: 30, windowMs: 60 * 60_000 }));

export async function OPTIONS() {
  return apiPreflight();
}

export async function GET() {
  return oauthError('invalid_request', 'Register with POST and a JSON body (RFC 7591).', 405, { Allow: 'POST, OPTIONS' });
}

export async function POST(request: Request) {
  const ip = clientIp(request.headers);
  const decision = limiter.check(ip);
  if (!decision.allowed) {
    return oauthError('rate_limited', 'Too many registrations from this address. Try again later.', 429, {
      'Retry-After': String(decision.retryAfterSeconds),
    });
  }

  const body = await readOAuthBody(request, MAX_BODY_BYTES);
  if (!body.ok) return oauthError('invalid_client_metadata', body.message);
  const parsed = parseRegistrationRequest(body.fields);
  if (!parsed.ok) return oauthError(parsed.error, parsed.description);

  try {
    const row = await insertDcrClient({ ...parsed.input, registration_ip: ip === 'unknown' ? null : ip });
    const kinds = [
      ...new Set(
        parsed.input.redirect_uris.map((uri) => {
          const display = redirectDisplay(uri);
          return display.loopback ? 'loopback' : display.app ? 'app' : 'https';
        })
      ),
    ]
      .sort()
      .join(',');
    captureServerEventAfterResponse(`oauth-client:${row.id}`, AnalyticsEvents.OAUTH_CLIENT_REGISTERED, {
      client_id: row.id,
      client_name: parsed.input.client_name,
      redirect_kinds: kinds,
      $process_person_profile: false,
    });
    return oauthJson(
      {
        client_id: row.id,
        client_id_issued_at: Math.floor(Date.parse(row.created_at) / 1000),
        ...(parsed.input.client_name ? { client_name: parsed.input.client_name } : {}),
        redirect_uris: parsed.input.redirect_uris,
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        token_endpoint_auth_method: 'none',
        ...(parsed.input.client_uri ? { client_uri: parsed.input.client_uri } : {}),
      },
      201
    );
  } catch (error) {
    console.error('[oauth/register] failed:', error instanceof Error ? error.message : 'unknown error');
    captureServerExceptionAfterResponse(error, { route: 'oauth/register' });
    return oauthError('server_error', 'Could not register the client. Try again.', 503, { 'Retry-After': '5' });
  }
}
