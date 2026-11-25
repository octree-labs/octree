import { apiJsonNoCors as apiJson } from '@/lib/api/http';
import { requestOrigin } from '@/lib/api/origin';
import { AnalyticsEvents } from '@/lib/analytics/events';
import { DEVICE_SCOPES, type DeviceScope, parseClientName } from '@/lib/device/codes';
import { issueDeviceAuthorization } from '@/lib/device/flow';
import { readDeviceBody } from '@/lib/device/http';
import { createDeviceStore } from '@/lib/device/store';
import { clientIp, createRateLimiter } from '@/lib/import/rate-limit';
import { captureServerEventAfterResponse, captureServerExceptionAfterResponse } from '@/lib/posthog-server';

/**
 * POST /api/v1/device/code: start device authorization (RFC 8628 section
 * 3.1) for an agent without a browser. No authentication.
 *
 *   { "client_name"?: "My agent", "scope"?: "compile" }
 *   -> { device_code, user_code, verification_uri, verification_uri_complete, expires_in: 900, interval: 5 }
 *
 * The agent shows the user verification_uri_complete (or the user_code and
 * verification_uri), then polls POST /api/v1/device/token. Limited to 10
 * requests per IP per 10 minutes (per process, lib/import/rate-limit.ts).
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const globalForDeviceCode = globalThis as unknown as {
  __octreeDeviceCodeLimiter__?: ReturnType<typeof createRateLimiter>;
};
const limiter = (globalForDeviceCode.__octreeDeviceCodeLimiter__ ??= createRateLimiter({
  limit: 10,
  windowMs: 10 * 60_000,
}));

function invalid(description: string): Response {
  return apiJson({ error: 'invalid_request', error_description: description, message: description }, 400);
}


export async function GET() {
  return apiJson(
    { error: 'method_not_allowed', message: 'Use POST, optionally with {"client_name": "..."}.' },
    405,
    { Allow: 'POST, OPTIONS' }
  );
}

export async function POST(request: Request) {
  const ip = clientIp(request.headers);
  const decision = limiter.check(ip);
  if (!decision.allowed) {
    return apiJson(
      { error: 'rate_limited', message: 'Too many device authorization requests. Try again shortly.' },
      429,
      { 'Retry-After': String(decision.retryAfterSeconds) }
    );
  }

  const body = await readDeviceBody(request);
  if (!body.ok) return invalid(body.message);

  const clientName = parseClientName(body.fields.client_name);
  if (!clientName.ok) return invalid('client_name must be a string of at most 60 characters.');

  const rawScope = body.fields.scope ?? 'compile';
  if (typeof rawScope !== 'string' || !(DEVICE_SCOPES as readonly string[]).includes(rawScope)) {
    return apiJson(
      { error: 'invalid_scope', error_description: 'The only scope is "compile".', message: 'The only scope is "compile".' },
      400
    );
  }
  const scope = rawScope as DeviceScope;

  try {
    const result = await issueDeviceAuthorization(createDeviceStore(), {
      clientName: clientName.name,
      scope,
      ip: ip === 'unknown' ? null : ip,
      origin: requestOrigin(request),
      now: Date.now(),
    });
    if (!result.ok) {
      return apiJson({ error: 'service_unavailable', message: 'Could not start device authorization. Try again.' }, 503, {
        'Retry-After': '5',
      });
    }
    captureServerEventAfterResponse(`device:${result.row.id}`, AnalyticsEvents.DEVICE_CODE_ISSUED, {
      client_name: clientName.name,
      scope,
      request_id: result.row.id,
      $process_person_profile: false,
    });
    return apiJson(result.body);
  } catch (error) {
    console.error('[api/v1/device/code] failed:', error instanceof Error ? error.message : 'unknown error');
    captureServerExceptionAfterResponse(error, { route: 'api/v1/device/code' });
    return apiJson({ error: 'service_unavailable', message: 'Could not start device authorization. Try again.' }, 503, {
      'Retry-After': '5',
    });
  }
}
