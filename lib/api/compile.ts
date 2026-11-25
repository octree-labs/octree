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
  type ApiQuotaSnapshot,
} from '@/lib/api/compile-result';
import { storeApiPdf } from '@/lib/api/artifacts';
import {
  API_UPGRADE_URL,
  dailyLimitFor,
  decideQuota,
  quotaResetsAt,
  secondsUntilReset,
  usedToday,
  utcDay,
  type ApiPlan,
  type ApiQuotaCounter,
  type QuotaExceededBody,
} from '@/lib/api/quota';

/**
 * One compile through the public API, shared by POST /api/v1/compile and
 * the MCP tools: quota (+1 before compiling), the compile service call with
 * a server credential (lib/compile/credential.ts; never a user token), and
 * the result shaped for the API. No project id is sent, so the compile
 * service never reuses another request's working directory.
 *
 * `mode: 'check'` (MCP check_latex) counts on the separate `checks`
 * counter and never stores a PDF. `storePdf` uploads a successful PDF to
 * the private `api-artifacts` bucket and returns a one-hour signed link
 * (lib/api/artifacts.ts) as `pdf_url`.
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

export type ApiCompileMode = 'compile' | 'check';

function track(
  principal: ApiPrincipal,
  via: ApiVia,
  mode: ApiCompileMode,
  request: ApiCompileRequest,
  ok: boolean,
  durationMs: number,
  errorKind?: CompileErrorKind,
  pdfUrl?: boolean
): void {
  captureServerEventAfterResponse(principal.userId, AnalyticsEvents.API_COMPILE, {
    ok,
    ...(errorKind ? { error_kind: errorKind } : {}),
    via,
    mode,
    duration_ms: durationMs,
    source_bytes: request.sourceBytes,
    plan: principal.plan,
    ...(pdfUrl !== undefined ? { pdf_url: pdfUrl } : {}),
  });
}

export interface RunApiCompileOptions {
  /** `check`: MCP check_latex. Own daily counter, no page count, no stored PDF. */
  mode?: ApiCompileMode;
  /** Upload a successful PDF and return a signed `pdf_url` (ignored in check mode). */
  storePdf?: boolean;
}

type AdminClient = ReturnType<typeof createAdminClient>;

/** PostgREST's "function not found" (the checks migration is not applied yet). */
function isMissingFunction(error: { code?: string; message?: string }): boolean {
  return error.code === 'PGRST202' || error.code === '42883' || /could not find the function|does not exist/i.test(error.message ?? '');
}

/**
 * +1 on today's counter, returning the count including this call. A check
 * falls back to the compile counter while `increment_api_check_usage` does
 * not exist, so check_latex keeps working during the rollout.
 */
async function countUsage(
  admin: AdminClient,
  userId: string,
  counter: ApiQuotaCounter
): Promise<{ count: number; counter: ApiQuotaCounter } | null> {
  const args = { p_user_id: userId, p_day: utcDay() };
  if (counter === 'checks') {
    const { data, error } = await admin.rpc('increment_api_check_usage', args);
    if (!error && typeof data === 'number') return { count: data, counter: 'checks' };
    if (!error || !isMissingFunction(error)) {
      console.error('[api-compile] increment_api_check_usage failed:', error?.message);
      return null;
    }
  }
  const { data, error } = await admin.rpc('increment_api_usage', args);
  if (error || typeof data !== 'number') {
    console.error('[api-compile] increment_api_usage failed:', error?.message);
    return null;
  }
  return { count: data, counter: 'compiles' };
}

function quotaSnapshot(counter: ApiQuotaCounter, used: number, limit: number): ApiQuotaSnapshot {
  return { counter, limit, used, remaining: Math.max(0, limit - used), resets_at: quotaResetsAt() };
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

  const mode: ApiCompileMode = options.mode ?? 'compile';
  const admin = createAdminClient();
  const usage = await countUsage(admin, principal.userId, mode === 'check' ? 'checks' : 'compiles');
  if (!usage) return unavailable('Usage accounting is unavailable. Try again later.');

  const quota = decideQuota(usage.count, principal.plan, new Date(), usage.counter);
  if (!quota.allowed) {
    captureServerEventAfterResponse(principal.userId, AnalyticsEvents.API_QUOTA_EXCEEDED, {
      via,
      limit: quota.body.limit,
      plan: principal.plan,
      counter: usage.counter,
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

  const snapshot = quotaSnapshot(usage.counter, quota.used, quota.limit);

  if (result.success && result.pdfBuffer && result.base64PDF) {
    const storePdf = mode === 'compile' && options.storePdf === true;
    const [pages, stored] = await Promise.all([
      mode === 'check' ? Promise.resolve(undefined) : countPdfPages(result.pdfBuffer),
      storePdf ? storeApiPdf(admin, principal.userId, result.pdfBuffer) : Promise.resolve(null),
    ]);
    const json = buildCompileSuccess(result.base64PDF, durationMs, pages, result.engine);
    if (storePdf) {
      json.pdf_url = stored?.url ?? null;
      json.pdf_url_expires_at = stored?.expires_at ?? null;
    }
    json.quota = snapshot;
    track(principal, via, mode, request, true, durationMs, undefined, storePdf ? stored !== null : undefined);
    return { kind: 'result', json, pdf: result.pdfBuffer };
  }

  const failure = classifyServiceFailure(result.error);
  switch (failure) {
    case 'latex': {
      const json = buildCompileFailure(result.error!, durationMs);
      json.quota = snapshot;
      track(principal, via, mode, request, false, durationMs, json.errors[0]?.kind ?? 'latex_error');
      return { kind: 'result', json };
    }
    case 'invalid_request':
      track(principal, via, mode, request, false, durationMs, 'request_rejected');
      return {
        kind: 'error',
        status: 400,
        body: {
          error: 'invalid_request',
          message: result.error?.details || result.error?.error || 'The compile service rejected the request.',
        },
      };
    case 'timeout':
      track(principal, via, mode, request, false, durationMs, 'timeout');
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
      track(principal, via, mode, request, false, durationMs, 'service_unavailable');
      return unavailable('The compile service is busy or unavailable. Try again shortly.');
  }
}

export interface ApiUsageSummary {
  user_id: string;
  plan: ApiPlan;
  daily_limit: number;
  used_today: number;
  remaining_today: number;
  /** MCP check_latex has its own daily counter. */
  checks_daily_limit: number;
  checks_used_today: number;
  resets_at: string;
  upgrade_url?: string;
}

/** GET /api/v1/me and the MCP `get_quota` tool. */
export async function getApiUsage(principal: ApiPrincipal): Promise<ApiUsageSummary> {
  // `*` rather than a column list: `checks` arrives with a later migration,
  // and naming a missing column would fail the whole read.
  const { data } = await createAdminClient()
    .from('api_usage_daily')
    .select('*')
    .eq('user_id', principal.userId)
    .eq('day', utcDay())
    .maybeSingle();
  const row = data as { compiles?: number; checks?: number } | null;
  const dailyLimit = dailyLimitFor(principal.plan);
  const used = usedToday(row?.compiles, principal.plan);
  return {
    user_id: principal.userId,
    plan: principal.plan,
    daily_limit: dailyLimit,
    used_today: used,
    remaining_today: Math.max(0, dailyLimit - used),
    checks_daily_limit: dailyLimitFor(principal.plan, 'checks'),
    checks_used_today: usedToday(row?.checks, principal.plan, 'checks'),
    resets_at: quotaResetsAt(),
    ...(principal.plan === 'free' ? { upgrade_url: API_UPGRADE_URL } : {}),
  };
}

export type { QuotaExceededBody };
