/**
 * Uptime / health monitor. Pure pieces (check runner, transition logic,
 * alert rendering) take injected dependencies so they can be tested with a
 * fake state store and fetch.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  COMPILE_SMOKE_INTERVAL_MINUTES,
  HEALTH_ALERT_COOLDOWN_MS,
  HEALTH_CHECK_TIMEOUT_MS,
  HEALTH_FAILURE_THRESHOLD,
} from './config';

// ---------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------

export interface CheckResult {
  name: string;
  ok: boolean;
  latencyMs: number;
  httpStatus?: number;
  error?: string;
  /** Informational: the check passed but reported something worth seeing. */
  note?: string;
}

export interface HealthCheck {
  name: string;
  run: (deps: CheckDeps) => Promise<Omit<CheckResult, 'name' | 'latencyMs'>>;
}

export interface CheckDeps {
  fetch: typeof fetch;
  timeoutMs: number;
}

export async function fetchWithTimeout(
  deps: CheckDeps,
  url: string,
  init?: RequestInit
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), deps.timeoutMs);
  try {
    return await deps.fetch(url, { ...init, signal: controller.signal, cache: 'no-store' });
  } finally {
    clearTimeout(timer);
  }
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.name === 'AbortError' ? 'timeout' : error.message;
  return String(error);
}

/** Plain `GET url` must return 200. */
export function httpOkCheck(name: string, url: string): HealthCheck {
  return {
    name,
    async run(deps) {
      try {
        const res = await fetchWithTimeout(deps, url, { redirect: 'manual' });
        return res.status === 200
          ? { ok: true, httpStatus: res.status }
          : { ok: false, httpStatus: res.status, error: `HTTP ${res.status}` };
      } catch (error) {
        return { ok: false, error: errorMessage(error) };
      }
    },
  };
}

/**
 * JSON health endpoint. The compile service answers `{status: "ok" |
 * "degraded" | "unhealthy"}` (503 when unhealthy); the agent service answers
 * `{status: "ok"}`. Anything other than 200 + ok/healthy/degraded is down;
 * degraded passes with a note.
 */
export function jsonHealthCheck(name: string, url: string): HealthCheck {
  return {
    name,
    async run(deps) {
      try {
        const res = await fetchWithTimeout(deps, url);
        let status: string | undefined;
        let issues: unknown;
        try {
          const body = (await res.json()) as { status?: string; issues?: unknown };
          status = body.status;
          issues = body.issues;
        } catch {
          return { ok: false, httpStatus: res.status, error: `HTTP ${res.status}, non-JSON body` };
        }
        if (res.status !== 200) return { ok: false, httpStatus: res.status, error: `HTTP ${res.status} (${status ?? 'no status'})` };
        if (status === 'ok' || status === 'healthy') return { ok: true, httpStatus: res.status };
        if (status === 'degraded') {
          const detail = Array.isArray(issues) ? issues.map(String).join('; ') : '';
          return { ok: true, httpStatus: res.status, note: `degraded${detail ? `: ${detail}` : ''}` };
        }
        return { ok: false, httpStatus: res.status, error: `status=${status ?? 'missing'}` };
      } catch (error) {
        return { ok: false, error: errorMessage(error) };
      }
    },
  };
}

export const SMOKE_TEX = [
  '\\documentclass{article}',
  '\\begin{document}',
  'Octree health check.',
  '$e^{i\\pi} + 1 = 0$',
  '\\end{document}',
].join('\n');

/**
 * Real compile round-trip, the same request shape `app/api/compile-pdf`
 * sends. The compile service verifies any HS256 token signed with the
 * project's JWT secret (no claim checks), so the Supabase service-role key,
 * which is such a token, authenticates it without a user session.
 */
export function compileSmokeCheck(name: string, compileServiceUrl: string, bearerToken: string): HealthCheck {
  return {
    name,
    async run(deps) {
      try {
        const res = await fetchWithTimeout(deps, `${compileServiceUrl}/compile`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${bearerToken}` },
          body: JSON.stringify({
            files: [{ path: 'main.tex', content: SMOKE_TEX }],
            projectId: 'ops-health-check',
            lastModifiedFile: 'main.tex',
          }),
        });
        if (res.status !== 200) {
          const text = (await res.text()).slice(0, 200);
          return { ok: false, httpStatus: res.status, error: `HTTP ${res.status}: ${text}` };
        }
        const bytes = new Uint8Array(await res.arrayBuffer());
        const magic = String.fromCharCode(...bytes.slice(0, 4));
        if (magic !== '%PDF') return { ok: false, httpStatus: res.status, error: `not a PDF (${bytes.length} bytes)` };
        return { ok: true, httpStatus: res.status, note: `${bytes.length} bytes` };
      } catch (error) {
        return { ok: false, error: errorMessage(error) };
      }
    },
  };
}

export async function runCheck(check: HealthCheck, deps: CheckDeps): Promise<CheckResult> {
  const started = Date.now();
  const result = await check.run(deps);
  return { name: check.name, latencyMs: Date.now() - started, ...result };
}

export async function runChecks(checks: HealthCheck[], deps: Partial<CheckDeps> = {}): Promise<CheckResult[]> {
  const full: CheckDeps = { fetch: deps.fetch ?? fetch, timeoutMs: deps.timeoutMs ?? HEALTH_CHECK_TIMEOUT_MS };
  return Promise.all(checks.map((c) => runCheck(c, full)));
}

// ---------------------------------------------------------------------------
// State + transitions
// ---------------------------------------------------------------------------

/**
 * `failing` is the anti-flap stage: one failure seen, not yet alerted. The
 * `since` column therefore always points at the first failure of an outage.
 */
export type CheckStatus = 'up' | 'failing' | 'down';

export interface CheckState {
  check_name: string;
  status: CheckStatus;
  since: string;
  last_checked: string;
  last_error: string | null;
  last_alert_at: string | null;
}

export interface StateStore {
  getAll(): Promise<CheckState[]>;
  upsert(states: CheckState[]): Promise<void>;
}

export type AlertKind = 'down' | 'recovered';

export interface Transition {
  next: CheckState;
  alert: AlertKind | null;
  previousStatus: CheckStatus | null;
}

export interface TransitionOptions {
  failureThreshold?: number;
  alertCooldownMs?: number;
}

function consecutiveFailures(prev: CheckState | undefined): number {
  if (!prev) return 0;
  if (prev.status === 'failing') return 1;
  if (prev.status === 'down') return Math.max(HEALTH_FAILURE_THRESHOLD, 2);
  return 0;
}

function cooldownPassed(prev: CheckState | undefined, nowMs: number, cooldownMs: number): boolean {
  if (!prev?.last_alert_at) return true;
  return nowMs - Date.parse(prev.last_alert_at) >= cooldownMs;
}

/**
 * Decides the next state and whether an alert fires.
 * - up -> down alerts only after `failureThreshold` consecutive failures.
 * - down -> up alerts on recovery. A single failure (`failing`) that recovers
 *   is a blip and stays silent.
 * - At most one alert per check per `alertCooldownMs`. A down alert that was
 *   suppressed by the cooldown is retried on later runs while still down.
 */
export function applyTransition(
  prev: CheckState | undefined,
  result: CheckResult,
  now: Date,
  options: TransitionOptions = {}
): Transition {
  const threshold = options.failureThreshold ?? HEALTH_FAILURE_THRESHOLD;
  const cooldownMs = options.alertCooldownMs ?? HEALTH_ALERT_COOLDOWN_MS;
  const nowIso = now.toISOString();
  const nowMs = now.getTime();
  const previousStatus = prev?.status ?? null;

  const base: CheckState = {
    check_name: result.name,
    status: 'up',
    since: prev?.since ?? nowIso,
    last_checked: nowIso,
    last_error: result.ok ? null : (result.error ?? 'failed'),
    last_alert_at: prev?.last_alert_at ?? null,
  };

  if (result.ok) {
    const recovered = prev?.status === 'down';
    const changed = prev?.status !== 'up';
    const alert = recovered && cooldownPassed(prev, nowMs, cooldownMs) ? 'recovered' : null;
    return {
      previousStatus,
      alert,
      next: {
        ...base,
        status: 'up',
        since: changed ? nowIso : base.since,
        last_alert_at: alert ? nowIso : base.last_alert_at,
      },
    };
  }

  const failures = consecutiveFailures(prev) + 1;
  const outageStart = prev && prev.status !== 'up' ? prev.since : nowIso;

  if (failures < threshold) {
    return { previousStatus, alert: null, next: { ...base, status: 'failing', since: outageStart } };
  }

  // Alert once per outage unless the cooldown blocked the first attempt.
  const alreadyAlerted = !!prev?.last_alert_at && Date.parse(prev.last_alert_at) >= Date.parse(outageStart);
  const alert = !alreadyAlerted && cooldownPassed(prev, nowMs, cooldownMs) ? 'down' : null;
  return {
    previousStatus,
    alert,
    next: { ...base, status: 'down', since: outageStart, last_alert_at: alert ? nowIso : base.last_alert_at },
  };
}

export interface MonitorOutcome {
  results: CheckResult[];
  transitions: Transition[];
  alerts: Array<{ kind: AlertKind; result: CheckResult; state: CheckState }>;
}

export async function evaluateAndPersist(
  results: CheckResult[],
  store: StateStore,
  now: Date,
  options: TransitionOptions = {}
): Promise<MonitorOutcome> {
  const existing = new Map((await store.getAll()).map((s) => [s.check_name, s]));
  const transitions = results.map((r) => applyTransition(existing.get(r.name), r, now, options));
  await store.upsert(transitions.map((t) => t.next));
  const alerts = transitions.flatMap((t, i) =>
    t.alert ? [{ kind: t.alert, result: results[i], state: t.next }] : []
  );
  return { results, transitions, alerts };
}

/** True when the hourly smoke test is due according to the stored state. */
export function smokeTestDue(
  states: CheckState[],
  checkName: string,
  now: Date,
  intervalMinutes = COMPILE_SMOKE_INTERVAL_MINUTES
): boolean {
  const prev = states.find((s) => s.check_name === checkName);
  if (!prev) return true;
  // Leave a few minutes of slack so a cron that fires slightly early still runs it.
  const slackMs = 5 * 60 * 1000;
  return now.getTime() - Date.parse(prev.last_checked) >= intervalMinutes * 60 * 1000 - slackMs;
}

// ---------------------------------------------------------------------------
// Alert email
// ---------------------------------------------------------------------------

export function alertSubject(alerts: MonitorOutcome['alerts']): string {
  const down = alerts.filter((a) => a.kind === 'down').map((a) => a.result.name);
  const up = alerts.filter((a) => a.kind === 'recovered').map((a) => a.result.name);
  const parts: string[] = [];
  if (down.length) parts.push(`DOWN: ${down.join(', ')}`);
  if (up.length) parts.push(`recovered: ${up.join(', ')}`);
  return `[Octree] ${parts.join(' | ')}`;
}

function esc(value: string | number): string {
  return String(value).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c);
}

export function renderAlertHtml(outcome: MonitorOutcome, now: Date): string {
  const lines = outcome.alerts.map((a) => {
    const since = a.state.since;
    const detail =
      a.kind === 'down'
        ? `down since ${esc(since)} — ${esc(a.result.error ?? 'failed')}`
        : `recovered at ${esc(now.toISOString())}`;
    return `<li><strong>${esc(a.result.name)}</strong>: ${detail}</li>`;
  });
  const rows = outcome.results
    .map(
      (r) =>
        `<tr><td style="padding:2px 8px">${esc(r.name)}</td><td style="padding:2px 8px">${r.ok ? 'up' : 'DOWN'}</td><td style="padding:2px 8px;text-align:right">${r.latencyMs} ms</td><td style="padding:2px 8px;color:#777">${esc(
          r.error ?? r.note ?? ''
        )}</td></tr>`
    )
    .join('');
  return `<!doctype html><html><body style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;font-size:14px;color:#111;padding:16px">
<h2 style="margin:0 0 8px">Octree health</h2>
<ul>${lines.join('')}</ul>
<table cellspacing="0" cellpadding="0" style="border-collapse:collapse;margin-top:12px">${rows}</table>
</body></html>`;
}

// ---------------------------------------------------------------------------
// Supabase-backed store
// ---------------------------------------------------------------------------

/** In-memory store, used when the table is unavailable and in tests. */
export function memoryStateStore(initial: CheckState[] = []): StateStore {
  const rows = new Map(initial.map((s) => [s.check_name, s]));
  return {
    async getAll() {
      return [...rows.values()];
    },
    async upsert(states) {
      for (const s of states) rows.set(s.check_name, s);
    },
  };
}

export function supabaseStateStore(client: SupabaseClient<any, any, any>): StateStore {
  return {
    async getAll() {
      const { data, error } = await client.from('ops_monitor_state').select('*');
      if (error) throw new Error(`ops_monitor_state read failed: ${error.message}`);
      return (data ?? []) as CheckState[];
    },
    async upsert(states) {
      if (!states.length) return;
      const { error } = await client.from('ops_monitor_state').upsert(states, { onConflict: 'check_name' });
      if (error) throw new Error(`ops_monitor_state write failed: ${error.message}`);
    },
  };
}
