/**
 * Shared configuration for the operational cron routes (daily digest, health
 * monitor). Everything that reads the environment lives here so the pure
 * computation modules stay testable without env access.
 */
import { timingSafeEqual } from 'node:crypto';

/** Owner address for digests and alerts. Unset means "do not send email". */
export function getOpsAlertEmail(): string | null {
  const value = process.env.OPS_ALERT_EMAIL?.trim();
  return value ? value : null;
}

/**
 * Vercel cron invocations carry `Authorization: Bearer ${CRON_SECRET}`.
 * A missing CRON_SECRET fails closed so the routes can never be hit
 * unauthenticated in an environment where the secret was forgotten. The
 * whole header is compared (no prefix match) in constant time.
 */
export function isCronRequestAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const expected = Buffer.from(`Bearer ${secret}`);
  const actual = Buffer.from(request.headers.get('authorization') ?? '');
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

/**
 * Health monitor cadence. The cron expression itself has to live in
 * `vercel.json` (Vercel reads it statically), so this is documentation plus
 * the value the smoke-test interval derives from. Note: Vercel Hobby only
 * runs crons once per day; `*​/10` requires Pro or above. If the deployment is
 * on Hobby, change the `health-check` entry in `vercel.json` to a daily
 * expression (e.g. `0 14 * * *`).
 */
export const HEALTH_CHECK_INTERVAL_MINUTES = 10;

/** The compile smoke test runs at most this often (in minutes). */
export const COMPILE_SMOKE_INTERVAL_MINUTES = 60;

/** Per-check HTTP timeout. */
export const HEALTH_CHECK_TIMEOUT_MS = 10_000;

/** Consecutive failures before a check is considered down. */
export const HEALTH_FAILURE_THRESHOLD = 2;

/** Minimum gap between two alert emails for the same check. */
export const HEALTH_ALERT_COOLDOWN_MS = 60 * 60 * 1000;
