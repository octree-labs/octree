import { describe, it, expect, vi } from 'vitest';

import {
  applyTransition,
  evaluateAndPersist,
  httpOkCheck,
  jsonHealthCheck,
  runChecks,
  smokeTestDue,
  alertSubject,
  type CheckResult,
  type CheckState,
  type StateStore,
} from '@/lib/ops/health';

const T0 = new Date('2026-10-18T12:00:00Z');
const plusMin = (m: number) => new Date(T0.getTime() + m * 60_000);
const ok = (name = 'www'): CheckResult => ({ name, ok: true, latencyMs: 10 });
const fail = (name = 'www'): CheckResult => ({ name, ok: false, latencyMs: 10, error: 'HTTP 503' });

function fakeStore(initial: CheckState[] = []): StateStore & { rows: Map<string, CheckState> } {
  const rows = new Map(initial.map((s) => [s.check_name, s]));
  return {
    rows,
    async getAll() {
      return [...rows.values()];
    },
    async upsert(states) {
      for (const s of states) rows.set(s.check_name, s);
    },
  };
}

describe('applyTransition', () => {
  it('starts a fresh check as up with no alert', () => {
    const t = applyTransition(undefined, ok(), T0);
    expect(t.next.status).toBe('up');
    expect(t.alert).toBeNull();
    expect(t.next.since).toBe(T0.toISOString());
  });

  it('needs two consecutive failures before alerting down', () => {
    const first = applyTransition(undefined, fail(), T0);
    expect(first.next.status).toBe('failing');
    expect(first.alert).toBeNull();

    const second = applyTransition(first.next, fail(), plusMin(10));
    expect(second.next.status).toBe('down');
    expect(second.alert).toBe('down');
    // Outage start is the first failure, not the second.
    expect(second.next.since).toBe(T0.toISOString());
    expect(second.next.last_alert_at).toBe(plusMin(10).toISOString());
    expect(second.next.last_error).toBe('HTTP 503');
  });

  it('treats a single failure followed by success as a blip (no alert)', () => {
    const failing = applyTransition(undefined, fail(), T0).next;
    const t = applyTransition(failing, ok(), plusMin(10));
    expect(t.next.status).toBe('up');
    expect(t.alert).toBeNull();
  });

  it('does not re-alert while still down, and alerts recovery once', () => {
    let state = applyTransition(undefined, fail(), T0).next;
    state = applyTransition(state, fail(), plusMin(10)).next; // alerted
    const third = applyTransition(state, fail(), plusMin(20));
    expect(third.alert).toBeNull();
    expect(third.next.status).toBe('down');

    // Recovery inside the cooldown hour is still suppressed...
    const earlyRecovery = applyTransition(third.next, ok(), plusMin(30));
    expect(earlyRecovery.next.status).toBe('up');
    expect(earlyRecovery.alert).toBeNull();

    // ...but after the cooldown the recovery alert goes out.
    const lateRecovery = applyTransition(third.next, ok(), plusMin(75));
    expect(lateRecovery.alert).toBe('recovered');
    expect(lateRecovery.next.last_alert_at).toBe(plusMin(75).toISOString());
    expect(lateRecovery.next.since).toBe(plusMin(75).toISOString());
  });

  it('retries a down alert that the cooldown suppressed', () => {
    // A recovery alert went out at T0; the service drops again right after.
    const up: CheckState = {
      check_name: 'www',
      status: 'up',
      since: T0.toISOString(),
      last_checked: T0.toISOString(),
      last_error: null,
      last_alert_at: T0.toISOString(),
    };
    const f1 = applyTransition(up, fail(), plusMin(10)).next;
    const f2 = applyTransition(f1, fail(), plusMin(20));
    expect(f2.next.status).toBe('down');
    expect(f2.alert).toBeNull(); // within the hour since the last alert

    const f3 = applyTransition(f2.next, fail(), plusMin(70));
    expect(f3.alert).toBe('down');
    expect(f3.next.last_alert_at).toBe(plusMin(70).toISOString());

    const f4 = applyTransition(f3.next, fail(), plusMin(80));
    expect(f4.alert).toBeNull();
  });

  it('honours a custom failure threshold', () => {
    const t1 = applyTransition(undefined, fail(), T0, { failureThreshold: 1 });
    expect(t1.next.status).toBe('down');
    expect(t1.alert).toBe('down');
  });
});

describe('evaluateAndPersist', () => {
  it('persists every check and returns only the alerts', async () => {
    const store = fakeStore([
      {
        check_name: 'compile-service',
        status: 'failing',
        since: T0.toISOString(),
        last_checked: T0.toISOString(),
        last_error: 'timeout',
        last_alert_at: null,
      },
    ]);
    const outcome = await evaluateAndPersist([ok('www'), fail('compile-service')], store, plusMin(10));
    expect(outcome.alerts.map((a) => [a.kind, a.result.name])).toEqual([['down', 'compile-service']]);
    expect(store.rows.get('www')?.status).toBe('up');
    expect(store.rows.get('compile-service')?.status).toBe('down');
    expect(alertSubject(outcome.alerts)).toBe('[Octree] DOWN: compile-service');
  });
});

describe('smokeTestDue', () => {
  it('is due when never run, and again ~an hour after the last run', () => {
    expect(smokeTestDue([], 'compile-smoke', T0)).toBe(true);
    const ran: CheckState = {
      check_name: 'compile-smoke',
      status: 'up',
      since: T0.toISOString(),
      last_checked: T0.toISOString(),
      last_error: null,
      last_alert_at: null,
    };
    expect(smokeTestDue([ran], 'compile-smoke', plusMin(10))).toBe(false);
    expect(smokeTestDue([ran], 'compile-smoke', plusMin(50))).toBe(false);
    expect(smokeTestDue([ran], 'compile-smoke', plusMin(56))).toBe(true);
  });
});

describe('check runners', () => {
  const mockFetch = (status: number, body?: unknown) =>
    vi.fn(async () =>
      new Response(body === undefined ? '' : JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      })
    ) as unknown as typeof fetch;

  it('httpOkCheck passes on 200 and fails otherwise', async () => {
    const [up] = await runChecks([httpOkCheck('www', 'https://example.com')], { fetch: mockFetch(200) });
    expect(up.ok).toBe(true);
    const [down] = await runChecks([httpOkCheck('www', 'https://example.com')], { fetch: mockFetch(500) });
    expect(down.ok).toBe(false);
    expect(down.error).toBe('HTTP 500');
  });

  it('jsonHealthCheck reads the status field', async () => {
    const run = (status: number, body: unknown) =>
      runChecks([jsonHealthCheck('compile-service', 'https://example.com/health')], { fetch: mockFetch(status, body) }).then((r) => r[0]);

    expect((await run(200, { status: 'ok' })).ok).toBe(true);
    expect((await run(200, { status: 'healthy' })).ok).toBe(true);
    const degraded = await run(200, { status: 'degraded', issues: ['High memory usage'] });
    expect(degraded.ok).toBe(true);
    expect(degraded.note).toBe('degraded: High memory usage');
    const unhealthy = await run(503, { status: 'unhealthy' });
    expect(unhealthy.ok).toBe(false);
    expect(unhealthy.error).toBe('HTTP 503 (unhealthy)');
    expect((await run(200, { status: 'weird' })).ok).toBe(false);
  });

  it('reports a timeout when fetch aborts', async () => {
    const hanging = vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_, reject) => {
          init?.signal?.addEventListener('abort', () => {
            const err = new Error('aborted');
            err.name = 'AbortError';
            reject(err);
          });
        })
    ) as unknown as typeof fetch;
    const [r] = await runChecks([httpOkCheck('www', 'https://example.com')], { fetch: hanging, timeoutMs: 20 });
    expect(r.ok).toBe(false);
    expect(r.error).toBe('timeout');
  });
});
