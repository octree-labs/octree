import 'server-only';

import { compileLatex } from '@/app/api/compile-pdf/compiler';
import { compileServiceToken } from '@/lib/compile/credential';
import { createAdminClient } from '@/lib/supabase/admin';
import { AnalyticsEvents, type ApiVia, type CompileErrorKind } from '@/lib/analytics/events';
import { captureServerEventAfterResponse } from '@/lib/posthog-server';
import type { ApiPrincipal } from '@/lib/api/auth';
import type { ApiCompileRequest } from '@/lib/api/compile-request';
import {
  buildCompileFailure,
  buildCompileSuccess,
  classifyServiceFailure,
  countPdfPages,
  type ApiCompileJson,
} from '@/lib/api/compile-result';
import {
  dailyLimitFor,
  decideQuota,
  quotaResetsAt,
  secondsUntilReset,
  usedToday,
  utcDay,
  type ApiPlan,
  type QuotaExceededBody,
} from '@/lib/api/quota';

/**
 * One compile through the public API, shared by POST /api/v1/compile and
 * the MCP tools: quota (+1 before compiling), the compile service call with
 * a server credential (lib/compile/credential.ts; never a user token), and
 * the result shaped for the API. No project id is sent, so the compile
 * service never reuses another request's working directory.
 */

/** Below the route's maxDuration (120s) so a slow compile is answered, not killed. */
export const API_COMPILE_TIMEOUT_MS = 100_000;

export type ApiCompileOutcome =
  | { kind: 'result'; json: ApiCompileJson; pdf?: Buffer }
  | { kind: 'error'; status: number; body: Record<string, unknown>; headers?: Record<string, string> };

function unavailable(message: string): ApiCompileOutcome {
  return {
    kind: 'error',
    status: 503,
    body: { error: 'compile_unavailable', message },
    headers: { 'Retry-After': '30' },
  };
}

function track(
  principal: ApiPrincipal,
  via: ApiVia,
  request: ApiCompileRequest,
  ok: boolean,
  durationMs: number,
  errorKind?: CompileErrorKind
): void {
  captureServerEventAfterResponse(principal.userId, AnalyticsEvents.API_COMPILE, {
    ok,
    ...(errorKind ? { error_kind: errorKind } : {}),
    via,
    duration_ms: durationMs,
    source_bytes: request.sourceBytes,
    plan: principal.plan,
  });
}

export interface RunApiCompileOptions {
  /** `check_latex`: compile but do not count pages (the PDF is dropped). */
  skipPageCount?: boolean;
}

export async function runApiCompile(
  principal: ApiPrincipal,
  request: ApiCompileRequest,
  via: ApiVia,
  options: RunApiCompileOptions = {}
): Promise<ApiCompileOutcome> {
  const compileUrl = process.env.COMPILE_SERVICE_URL?.replace(/\/$/, '');
  const credential = compileServiceToken();
  if (!compileUrl || !credential) {
    console.error('[api-compile] COMPILE_SERVICE_URL or the compile credential is not configured');
    return unavailable('The compile service is not configured. Try again later.');
  }

  const admin = createAdminClient();
  const { data: count, error: usageError } = await admin.rpc('increment_api_usage', {
    p_user_id: principal.userId,
    p_day: utcDay(),
  });
  if (usageError || typeof count !== 'number') {
    console.error('[api-compile] increment_api_usage failed:', usageError?.message);
    return unavailable('Usage accounting is unavailable. Try again later.');
  }

  const quota = decideQuota(count, principal.plan);
  if (!quota.allowed) {
    captureServerEventAfterResponse(principal.userId, AnalyticsEvents.API_QUOTA_EXCEEDED, {
      via,
      limit: quota.body.limit,
      plan: principal.plan,
    });
    return {
      kind: 'error',
      status: 429,
      body: quota.body as unknown as Record<string, unknown>,
      headers: { 'Retry-After': String(secondsUntilReset()) },
    };
  }

  const started = Date.now();
  const result = await compileLatex(
    { files: request.files, lastModifiedFile: request.main },
    compileUrl,
    credential,
    API_COMPILE_TIMEOUT_MS
  );
  const durationMs = Date.now() - started;

  if (result.success && result.pdfBuffer && result.base64PDF) {
    const pages = options.skipPageCount ? undefined : await countPdfPages(result.pdfBuffer);
    track(principal, via, request, true, durationMs);
    return { kind: 'result', json: buildCompileSuccess(result.base64PDF, durationMs, pages), pdf: result.pdfBuffer };
  }

  const failure = classifyServiceFailure(result.error);
  switch (failure) {
    case 'latex': {
      const json = buildCompileFailure(result.error!, durationMs);
      track(principal, via, request, false, durationMs, json.errors[0]?.kind ?? 'latex_error');
      return { kind: 'result', json };
    }
    case 'invalid_request':
      track(principal, via, request, false, durationMs, 'request_rejected');
      return {
        kind: 'error',
        status: 400,
        body: {
          error: 'invalid_request',
          message: result.error?.details || result.error?.error || 'The compile service rejected the request.',
        },
      };
    case 'timeout':
      track(principal, via, request, false, durationMs, 'timeout');
      return {
        kind: 'error',
        status: 504,
        body: {
          error: 'compile_timeout',
          message: `Compilation did not finish within ${API_COMPILE_TIMEOUT_MS / 1000} seconds.`,
        },
      };
    default:
      console.error('[api-compile] compile service unavailable:', result.error?.status ?? 'no response', result.error?.error);
      track(principal, via, request, false, durationMs, 'service_unavailable');
      return unavailable('The compile service is busy or unavailable. Try again shortly.');
  }
}

export interface ApiUsageSummary {
  user_id: string;
  plan: ApiPlan;
  daily_limit: number;
  used_today: number;
  resets_at: string;
}

/** GET /api/v1/me and the MCP `get_quota` tool. */
export async function getApiUsage(principal: ApiPrincipal): Promise<ApiUsageSummary> {
  const { data } = await createAdminClient()
    .from('api_usage_daily')
    .select('compiles')
    .eq('user_id', principal.userId)
    .eq('day', utcDay())
    .maybeSingle();
  return {
    user_id: principal.userId,
    plan: principal.plan,
    daily_limit: dailyLimitFor(principal.plan),
    used_today: usedToday(data?.compiles, principal.plan),
    resets_at: quotaResetsAt(),
  };
}

export type { QuotaExceededBody };
