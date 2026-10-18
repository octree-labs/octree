import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { isCronRequestAuthorized } from '@/lib/ops/config';
import {
  alertSubject,
  compileSmokeCheck,
  evaluateAndPersist,
  httpOkCheck,
  jsonHealthCheck,
  renderAlertHtml,
  runChecks,
  smokeTestDue,
  memoryStateStore,
  supabaseStateStore,
  type CheckState,
  type HealthCheck,
  type StateStore,
} from '@/lib/ops/health';
import { sendOpsEmail } from '@/lib/ops/alert-email';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const COMPILE_SMOKE_CHECK = 'compile-smoke';

function safeOrigin(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

function buildChecks(now: Date, existingStates: CheckState[], forceSmoke: boolean) {
  const checks: HealthCheck[] = [];
  const skipped: string[] = [];

  const compileUrl = process.env.COMPILE_SERVICE_URL?.replace(/\/$/, '');
  // CLAUDE_AGENT_SERVICE_URL is the full `/agent` endpoint; /health is at the
  // service root (services/agent/agent-service.ts).
  const agentOrigin = safeOrigin(process.env.CLAUDE_AGENT_SERVICE_URL);

  if (compileUrl) checks.push(jsonHealthCheck('compile-service', `${compileUrl}/health`));
  else skipped.push('compile-service (COMPILE_SERVICE_URL unset)');

  if (agentOrigin) checks.push(jsonHealthCheck('agent-service', `${agentOrigin}/health`));
  else skipped.push('agent-service (CLAUDE_AGENT_SERVICE_URL unset or invalid)');

  checks.push(httpOkCheck('app-login', 'https://app.useoctree.com/auth/login'));
  checks.push(httpOkCheck('www', 'https://www.useoctree.com/'));
  checks.push(httpOkCheck('tools', 'https://tools.useoctree.com/'));

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!compileUrl) {
    skipped.push(`${COMPILE_SMOKE_CHECK} (COMPILE_SERVICE_URL unset)`);
  } else if (!serviceKey || !serviceKey.startsWith('ey')) {
    skipped.push(`${COMPILE_SMOKE_CHECK} (SUPABASE_SERVICE_ROLE_KEY is not a JWT the compile service accepts)`);
  } else if (forceSmoke || smokeTestDue(existingStates, COMPILE_SMOKE_CHECK, now)) {
    checks.push(compileSmokeCheck(COMPILE_SMOKE_CHECK, compileUrl, serviceKey));
  } else {
    skipped.push(`${COMPILE_SMOKE_CHECK} (not due; runs hourly)`);
  }

  return { checks, skipped };
}

/**
 * Uptime monitor. Scheduled in `vercel.json` (every 10 minutes on Pro; see
 * `HEALTH_CHECK_INTERVAL_MINUTES` in lib/ops/config.ts for the Hobby caveat).
 * `?smoke=1` forces the compile smoke test; `?dry=1` skips alert emails.
 */
export async function GET(request: Request) {
  if (!isCronRequestAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const params = new URL(request.url).searchParams;
  const dry = params.get('dry') === '1';
  const forceSmoke = params.get('smoke') === '1';
  const now = new Date();

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
  let store: StateStore = supabaseStateStore(supabase);
  const notes: string[] = [];

  try {
    let existing: CheckState[];
    try {
      existing = await store.getAll();
    } catch (error) {
      // Table missing (migration not applied yet) or unreachable: still run the
      // probes, but without memory there is no anti-flap or alerting.
      notes.push(`state store unavailable, running stateless: ${error instanceof Error ? error.message : String(error)}`);
      store = memoryStateStore();
      existing = [];
    }
    const { checks, skipped } = buildChecks(now, existing, forceSmoke);
    const results = await runChecks(checks);
    const outcome = await evaluateAndPersist(results, store, now);

    let email: Awaited<ReturnType<typeof sendOpsEmail>> | null = null;
    if (outcome.alerts.length) {
      email = dry
        ? { sent: false, reason: 'dry run' }
        : await sendOpsEmail({ subject: alertSubject(outcome.alerts), html: renderAlertHtml(outcome, now) });
    }

    const allUp = results.every((r) => r.ok);
    return NextResponse.json(
      {
        ok: allUp,
        checkedAt: now.toISOString(),
        checks: outcome.transitions.map((t, i) => ({
          name: results[i].name,
          ok: results[i].ok,
          latencyMs: results[i].latencyMs,
          httpStatus: results[i].httpStatus ?? null,
          error: results[i].error ?? null,
          note: results[i].note ?? null,
          state: t.next.status,
          since: t.next.since,
          previousState: t.previousStatus,
        })),
        alerts: outcome.alerts.map((a) => ({ kind: a.kind, check: a.result.name })),
        email,
        skipped,
        notes,
      },
      { status: allUp ? 200 : 503 }
    );
  } catch (error) {
    console.error('[ops] health check failed:', error);
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
