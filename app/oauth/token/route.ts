import { apiPreflight } from '@/lib/api/http';
import { generateApiKey } from '@/lib/api/keys';
import { requestOrigin } from '@/lib/api/origin';
import { AnalyticsEvents } from '@/lib/analytics/events';
import { exchangeAuthorizationCode, refreshAccessToken, type TokenResult } from '@/lib/oauth/flow';
import { basicClientId, oauthError, oauthJson, readOAuthBody } from '@/lib/oauth/http';
import { createOAuthStore } from '@/lib/oauth/store';
import { captureServerEventAfterResponse, captureServerExceptionAfterResponse } from '@/lib/posthog-server';

/**
 * POST /oauth/token (OAuth 2.1 token endpoint). Form-urlencoded per RFC 6749
 * (JSON accepted too). Public clients: client_id in the body (or Basic auth
 * with an empty secret), no client secret.
 *
 *   grant_type=authorization_code  code, redirect_uri, client_id, code_verifier (PKCE S256)
 *   grant_type=refresh_token       refresh_token, client_id
 *
 * 200 { access_token: "oct_live_...", token_type: "Bearer", expires_in: 3600,
 *       refresh_token: "oct_rt_...", scope }
 *
 * The access token is an Octree API key that expires in an hour; it works
 * on /api/mcp and /api/v1/* only. Refresh tokens rotate on every use, and a
 * reused one revokes the grant (invalid_grant). Only database lookups, no
 * outbound calls, so it answers well inside clients' 10 second budget.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_BODY_BYTES = 8 * 1024;

export async function OPTIONS() {
  return apiPreflight();
}

export async function GET() {
  return oauthError('invalid_request', 'Use POST with application/x-www-form-urlencoded.', 405, { Allow: 'POST, OPTIONS' });
}

function respond(result: TokenResult): Response {
  if (result.ok) return oauthJson(result.body);
  return oauthError(result.error, result.description, result.status ?? 400);
}

export async function POST(request: Request) {
  const body = await readOAuthBody(request, MAX_BODY_BYTES);
  if (!body.ok) return oauthError('invalid_request', body.message);
  const fields = body.fields;

  const basic = basicClientId(request.headers.get('authorization'));
  if (basic.secretSent) {
    return oauthError('invalid_client', 'Octree clients are public: send client_id without a secret.', 401, {
      'WWW-Authenticate': 'Basic realm="octree"',
    });
  }
  const clientId = fields.client_id ?? basic.clientId;
  if (basic.clientId && fields.client_id !== undefined && fields.client_id !== basic.clientId) {
    return oauthError('invalid_request', 'client_id in the body and the Authorization header differ.');
  }

  const grantType = fields.grant_type;
  const origin = requestOrigin(request);
  const now = Date.now();
  const store = createOAuthStore();

  try {
    if (grantType === 'authorization_code') {
      const result = await exchangeAuthorizationCode(store, {
        code: fields.code,
        clientId,
        redirectUri: fields.redirect_uri,
        codeVerifier: fields.code_verifier,
        resource: fields.resource,
        origin,
        now,
        generateKey: generateApiKey,
      });
      if (result.ok) {
        captureServerEventAfterResponse(result.grant.user_id, AnalyticsEvents.OAUTH_TOKEN_ISSUED, {
          grant_id: result.grant.id,
          client_kind: result.grant.client_kind,
          client_name: result.grant.client_name,
        });
      }
      return respond(result);
    }
    if (grantType === 'refresh_token') {
      const result = await refreshAccessToken(store, {
        refreshToken: fields.refresh_token,
        clientId,
        scope: fields.scope,
        resource: fields.resource,
        origin,
        now,
        generateKey: generateApiKey,
      });
      if (result.ok) {
        captureServerEventAfterResponse(result.grant.user_id, AnalyticsEvents.OAUTH_TOKEN_REFRESHED, {
          grant_id: result.grant.id,
          client_kind: result.grant.client_kind,
        });
      }
      return respond(result);
    }
    if (grantType === undefined || grantType === '') return oauthError('invalid_request', 'grant_type is required.');
    return oauthError('unsupported_grant_type', 'grant_type must be authorization_code or refresh_token.');
  } catch (error) {
    console.error('[oauth/token] failed:', error instanceof Error ? error.message : 'unknown error');
    captureServerExceptionAfterResponse(error, { route: 'oauth/token' });
    return oauthError('server_error', 'Could not issue tokens. Try again.', 503, { 'Retry-After': '5' });
  }
}
