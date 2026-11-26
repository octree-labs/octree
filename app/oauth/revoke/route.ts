import { apiPreflight } from '@/lib/api/http';
import { AnalyticsEvents } from '@/lib/analytics/events';
import { revokeToken } from '@/lib/oauth/flow';
import { basicClientId, oauthError, oauthJson, readOAuthBody } from '@/lib/oauth/http';
import { createOAuthStore } from '@/lib/oauth/store';
import { captureServerEventAfterResponse, captureServerExceptionAfterResponse } from '@/lib/posthog-server';

/**
 * POST /oauth/revoke (RFC 7009). `token` = a refresh token (revokes the
 * whole connection) or an OAuth access token (that token only). Always 200
 * for a well-formed request, whether or not the token was known; manual API
 * keys cannot be revoked here (use Settings).
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_BODY_BYTES = 8 * 1024;

export async function OPTIONS() {
  return apiPreflight();
}

export async function POST(request: Request) {
  const body = await readOAuthBody(request, MAX_BODY_BYTES);
  if (!body.ok) return oauthError('invalid_request', body.message);
  const basic = basicClientId(request.headers.get('authorization'));
  if (basic.secretSent) return oauthError('invalid_client', 'Octree clients are public: send client_id without a secret.', 401);
  const { token } = body.fields;
  if (typeof token !== 'string' || !token) return oauthError('invalid_request', 'token is required.');

  try {
    const outcome = await revokeToken(createOAuthStore(), {
      token,
      clientId: body.fields.client_id ?? basic.clientId,
      now: Date.now(),
    });
    if (outcome.revoked && outcome.userId) {
      captureServerEventAfterResponse(outcome.userId, AnalyticsEvents.OAUTH_TOKEN_REVOKED, {
        grant_id: outcome.grantId,
        by: 'client',
        what: outcome.revoked,
      });
    }
    return oauthJson({});
  } catch (error) {
    console.error('[oauth/revoke] failed:', error instanceof Error ? error.message : 'unknown error');
    captureServerExceptionAfterResponse(error, { route: 'oauth/revoke' });
    return oauthError('server_error', 'Could not revoke the token. Try again.', 503, { 'Retry-After': '5' });
  }
}
