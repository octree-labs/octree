import { apiJson, apiPreflight } from '@/lib/api/http';
import { requestOrigin } from '@/lib/api/oauth-metadata';
import { AnalyticsEvents } from '@/lib/analytics/events';
import { DEVICE_CODE_GRANT_TYPE, DEVICE_POLL_INTERVAL, hashDeviceCode, isDeviceCodeFormat } from '@/lib/device/codes';
import { deviceFlowSecret } from '@/lib/device/crypto';
import { pollDeviceToken } from '@/lib/device/flow';
import { readDeviceBody } from '@/lib/device/http';
import { createDeviceStore } from '@/lib/device/store';
import { clientIp, createRateLimiter } from '@/lib/import/rate-limit';
import { captureServerEventAfterResponse, captureServerExceptionAfterResponse } from '@/lib/posthog-server';

/**
 * POST /api/v1/device/token: the agent polls with its device_code
 * (RFC 8628 section 3.4). JSON `{ "device_code": "..." }`, or form-encoded
 * `grant_type=urn:ietf:params:oauth:grant-type:device_code&device_code=...`.
 *
 * Until the user decides: 400 `authorization_pending` (or `slow_down` when
 * polled faster than every 5 seconds). Then, exactly once:
 *   200 { api_key: "oct_live_...", token_type: "bearer", mcp_url, rest_base }
 * after which the code is spent (`expired_token`). `access_denied` when the
 * user said no, `expired_token` after 15 minutes. Errors are RFC 6749
 * section 5.2 JSON: { error, error_description }.
 *
 * Limits (per process): 60 polls a minute per IP, and 20 a minute per
 * device code (answered `slow_down` without a database read).
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const globalForDeviceToken = globalThis as unknown as {
  __octreeDeviceTokenIpLimiter__?: ReturnType<typeof createRateLimiter>;
  __octreeDeviceTokenCodeLimiter__?: ReturnType<typeof createRateLimiter>;
};
const ipLimiter = (globalForDeviceToken.__octreeDeviceTokenIpLimiter__ ??= createRateLimiter({
  limit: 60,
  windowMs: 60_000,
}));
const codeLimiter = (globalForDeviceToken.__octreeDeviceTokenCodeLimiter__ ??= createRateLimiter({
  limit: 20,
  windowMs: 60_000,
}));

function oauthError(error: string, description: string, status = 400, extra: Record<string, unknown> = {}): Response {
  return apiJson({ error, error_description: description, ...extra }, status);
}

export async function OPTIONS() {
  return apiPreflight();
}

export async function GET() {
  return apiJson(
    { error: 'method_not_allowed', message: 'Use POST with {"device_code": "..."}.' },
    405,
    { Allow: 'POST, OPTIONS' }
  );
}

export async function POST(request: Request) {
  const ip = clientIp(request.headers);
  const ipDecision = ipLimiter.check(ip);
  if (!ipDecision.allowed) {
    return apiJson(
      { error: 'rate_limited', error_description: 'Too many requests from this address. Try again shortly.' },
      429,
      { 'Retry-After': String(ipDecision.retryAfterSeconds) }
    );
  }

  const body = await readDeviceBody(request);
  if (!body.ok) return oauthError('invalid_request', body.message);
  const { grant_type: grantType, device_code: deviceCode } = body.fields;
  if (grantType !== undefined && grantType !== DEVICE_CODE_GRANT_TYPE) {
    return oauthError('unsupported_grant_type', `grant_type must be ${DEVICE_CODE_GRANT_TYPE}.`);
  }
  if (deviceCode === undefined || deviceCode === '') return oauthError('invalid_request', 'device_code is required.');
  if (!isDeviceCodeFormat(deviceCode)) return oauthError('invalid_grant', 'Unknown device_code.');

  if (!codeLimiter.check(hashDeviceCode(deviceCode)).allowed) {
    return oauthError('slow_down', `Polling too fast. Wait at least ${DEVICE_POLL_INTERVAL + 5} seconds between requests.`, 400, {
      interval: DEVICE_POLL_INTERVAL + 5,
    });
  }

  const now = Date.now();
  try {
    const result = await pollDeviceToken(createDeviceStore(), deviceCode, {
      now,
      secret: deviceFlowSecret(),
      origin: requestOrigin(request),
    });
    if (result.kind === 'error') {
      return oauthError(result.error, result.description, 400, result.interval ? { interval: result.interval } : {});
    }
    const { row } = result;
    if (row.user_id) {
      captureServerEventAfterResponse(row.user_id, AnalyticsEvents.DEVICE_TOKEN_ISSUED, {
        client_name: row.client_name,
        request_id: row.id,
        seconds_to_complete: Math.max(0, Math.round((now - Date.parse(row.created_at)) / 1000)),
      });
    }
    return apiJson(result.body);
  } catch (error) {
    console.error('[api/v1/device/token] failed:', error instanceof Error ? error.message : 'unknown error');
    captureServerExceptionAfterResponse(error, { route: 'api/v1/device/token' });
    // Not an RFC 8628 error: clients keep polling on 5xx.
    return apiJson({ error: 'service_unavailable', error_description: 'Try again shortly.' }, 503, { 'Retry-After': '5' });
  }
}
