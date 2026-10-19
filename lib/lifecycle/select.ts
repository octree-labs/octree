/**
 * Eligibility rules for the lifecycle emails, pure over injected rows so
 * they can be unit-tested without Supabase or Stripe. The cron route
 * (app/api/cron/lifecycle) loads the rows, calls `selectLifecycleCandidates`
 * and sends what comes back.
 *
 * Rules (all require an email, no suppression, no opt-out, not already sent,
 * not staff and no subscription relationship — see `hasSubscription`):
 *   welcome    1..3d after sign-up, no project. The Inngest "Welcome to
 *              Octree" goes out at confirmation, so this one waits a day.
 *   limit_hit  free user whose daily counter sits at the limit
 *              (edit_count >= 5) for today or yesterday. `daily_reset_date`
 *              is the day the counter started, set by increment_edit_count.
 *   day7       7..14d after sign-up, has a project
 *   winback    has a Stripe customer, subscription ended >= 7d ago
 *
 * One email per user per run, highest-priority template first
 * (limit_hit > day7 > welcome > winback), oldest-eligible first, capped.
 */
import type { LifecycleEmailContent, LifecycleTemplate, LifecycleTemplateInput, ScheduledLifecycleTemplate } from '@/lib/email/lifecycle';
import { isAdminEmail } from '@/lib/admin';
import { hasUnlimitedEdits } from '@/lib/paywall';

export interface LifecycleUserRow {
  userId: string;
  /** null when the auth user has no email (phone/anonymous). */
  email: string | null;
  /** Sign-up time (auth.users.created_at). */
  createdAt: string | null;
  /** user_usage.edit_count: the free daily counter, capped at the limit. */
  editCount: number;
  /** user_usage.daily_reset_date: the day `editCount` started counting. */
  dailyResetDate: string | null;
  isPro: boolean;
  subscriptionStatus: string | null;
  stripeCustomerId: string | null;
  /** `unlimited` and other staff roles never get upsell email. */
  role: string | null;
  /** Earliest projects.created_at for the user, null when they have none. */
  firstProjectAt: string | null;
  /**
   * When the user's last Stripe subscription ended (ended_at / canceled_at),
   * null when unknown or still active. Loaded only for win-back candidates.
   */
  subscriptionEndedAt: string | null;
}

export interface LifecycleSelectionInput {
  users: LifecycleUserRow[];
  /** Lower-cased addresses from email_suppressions. */
  suppressedEmails: Iterable<string>;
  /** user ids with email_preferences.marketing_opt_out = true. */
  optedOutUserIds: Iterable<string>;
  /**
   * Already-sent (user_id, template) pairs from lifecycle_emails. Rows of
   * the billing-recovery templates carry a `ref` and are ignored here.
   */
  sent: Iterable<{ userId: string; template: string; ref?: string }>;
  enabledTemplates: ReadonlySet<ScheduledLifecycleTemplate> | ScheduledLifecycleTemplate[];
  now: Date;
  /** Maximum sends per run across all templates. */
  cap?: number;
}

export interface LifecycleCandidate {
  userId: string;
  email: string;
  template: LifecycleTemplate;
  /** The timestamp that made the user eligible; the run sends oldest first. */
  eligibleSince: number;
  /**
   * Ledger key for the billing-recovery templates: the invoice or Checkout
   * Session id the email is about. Absent ('' in the table) for the
   * scheduled templates, which go out once per user.
   */
  ref?: string;
  /** Stored on the ledger row for the follow-up to use (recovery url, plan, amounts). */
  payload?: Record<string, unknown>;
  /**
   * Renders the email for a billing-recovery template, which needs its
   * Stripe data; the scheduled templates render from the app URLs alone.
   */
  render?: (input: LifecycleTemplateInput) => LifecycleEmailContent;
  /** Transactional notices skip the marketing opt-out (suppressions still apply). */
  transactional?: boolean;
}

export interface LifecycleSelection {
  /** Candidates to send this run, in send order (already capped). */
  toSend: LifecycleCandidate[];
  /** Everyone eligible per template before the cap, oldest first. */
  eligible: Record<ScheduledLifecycleTemplate, LifecycleCandidate[]>;
}

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

export const LIFECYCLE_RULES = {
  welcome: { minAgeMs: 1 * DAY_MS, maxAgeMs: 3 * DAY_MS },
  /**
   * `recencyMs` is measured from 00:00 UTC of `daily_reset_date` (a date,
   * not a timestamp), so 2 days means "the limit was hit today or yesterday".
   */
  limit_hit: { minEdits: 5, recencyMs: 2 * DAY_MS },
  day7: { minAgeMs: 7 * DAY_MS, maxAgeMs: 14 * DAY_MS },
  winback: { minLapsedMs: 7 * DAY_MS },
} as const;

export const DEFAULT_SEND_CAP = 200;

/** Templates in the order a user who qualifies for several gets them. */
export const TEMPLATE_PRIORITY: readonly ScheduledLifecycleTemplate[] = ['limit_hit', 'day7', 'welcome', 'winback'];

/**
 * Statuses that mean the user has a subscription relationship Octree must
 * not upsell or win back against: live (`active`, `trialing`), in dunning
 * (`past_due`: Stripe is still retrying the card), paused through the cancel
 * flow (`paused`, PR #398: free tier until collection resumes), or staff
 * (`unlimited`).
 */
export const SUBSCRIPTION_STATUSES = new Set(['active', 'trialing', 'past_due', 'paused', 'unlimited']);
const STAFF_ROLES = new Set(['unlimited', 'admin']);

function ms(value: string | null): number | null {
  if (!value) return null;
  const t = Date.parse(value);
  return Number.isNaN(t) ? null : t;
}

/** Pro, or any status in `SUBSCRIPTION_STATUSES`. */
export function hasSubscription(user: LifecycleUserRow): boolean {
  return user.isPro || SUBSCRIPTION_STATUSES.has(user.subscriptionStatus ?? '');
}

/** Staff by role or by the edit/admin email whitelists (lib/paywall, lib/admin). */
export function isStaff(user: LifecycleUserRow): boolean {
  return STAFF_ROLES.has(user.role ?? '') || hasUnlimitedEdits(user.email) || isAdminEmail(user.email);
}

/**
 * Returns the timestamp that makes the user eligible for the template, or
 * null when the rule does not apply. Independent of suppression, opt-out and
 * dedupe, which `selectLifecycleCandidates` layers on top.
 */
export function eligibleSince(user: LifecycleUserRow, template: ScheduledLifecycleTemplate, now: Date): number | null {
  const nowMs = now.getTime();
  if (isStaff(user) || hasSubscription(user)) return null;

  switch (template) {
    case 'welcome': {
      const created = ms(user.createdAt);
      if (created === null || user.firstProjectAt) return null;
      const age = nowMs - created;
      if (age < LIFECYCLE_RULES.welcome.minAgeMs || age > LIFECYCLE_RULES.welcome.maxAgeMs) return null;
      return created + LIFECYCLE_RULES.welcome.minAgeMs;
    }
    case 'limit_hit': {
      if (user.editCount < LIFECYCLE_RULES.limit_hit.minEdits) return null;
      const resetDay = ms(user.dailyResetDate);
      if (resetDay === null || nowMs - resetDay > LIFECYCLE_RULES.limit_hit.recencyMs) return null;
      return resetDay;
    }
    case 'day7': {
      const created = ms(user.createdAt);
      if (created === null || !user.firstProjectAt) return null;
      const age = nowMs - created;
      if (age < LIFECYCLE_RULES.day7.minAgeMs || age > LIFECYCLE_RULES.day7.maxAgeMs) return null;
      return created + LIFECYCLE_RULES.day7.minAgeMs;
    }
    case 'winback': {
      if (!user.stripeCustomerId) return null;
      const ended = ms(user.subscriptionEndedAt);
      if (ended === null || nowMs - ended < LIFECYCLE_RULES.winback.minLapsedMs) return null;
      return ended + LIFECYCLE_RULES.winback.minLapsedMs;
    }
  }
}

/**
 * Cheap pre-filter for win-back: the users whose Stripe subscriptions are
 * worth reading. Everything except the lapsed-for-7-days check, which needs
 * `subscriptionEndedAt`.
 */
export function isWinbackPrecandidate(user: LifecycleUserRow): boolean {
  return !!user.email && !!user.stripeCustomerId && !hasSubscription(user) && !isStaff(user);
}

export function selectLifecycleCandidates(input: LifecycleSelectionInput): LifecycleSelection {
  const suppressed = new Set(Array.from(input.suppressedEmails, (e) => e.toLowerCase()));
  const optedOut = new Set(input.optedOutUserIds);
  const sentKeys = new Set(
    Array.from(input.sent)
      .filter((s) => !s.ref)
      .map((s) => `${s.userId}:${s.template}`)
  );
  const enabled = new Set(input.enabledTemplates);
  const cap = input.cap ?? DEFAULT_SEND_CAP;

  const eligible: Record<ScheduledLifecycleTemplate, LifecycleCandidate[]> = {
    welcome: [],
    limit_hit: [],
    day7: [],
    winback: [],
  };

  const claimed = new Set<string>();
  for (const template of TEMPLATE_PRIORITY) {
    for (const user of input.users) {
      if (!user.email) continue;
      const email = user.email.toLowerCase();
      if (suppressed.has(email) || optedOut.has(user.userId)) continue;
      if (sentKeys.has(`${user.userId}:${template}`)) continue;
      const since = eligibleSince(user, template, input.now);
      if (since === null) continue;
      eligible[template].push({ userId: user.userId, email, template, eligibleSince: since });
    }
    eligible[template].sort((a, b) => a.eligibleSince - b.eligibleSince || a.userId.localeCompare(b.userId));
  }

  const toSend: LifecycleCandidate[] = [];
  for (const template of TEMPLATE_PRIORITY) {
    if (!enabled.has(template)) continue;
    for (const candidate of eligible[template]) {
      if (toSend.length >= cap) break;
      if (claimed.has(candidate.userId)) continue;
      claimed.add(candidate.userId);
      toSend.push(candidate);
    }
  }

  return { toSend, eligible };
}
