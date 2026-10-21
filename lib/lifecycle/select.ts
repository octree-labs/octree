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
 *   pro_inactive  entitled to Pro (lib/subscription/entitlement.ts), at
 *              least 7 days into the current billing period, and no
 *              activity for 7 days (no project saved, no document generated,
 *              no AI edit counted). The only template for subscribers; at
 *              most one per calendar month (ledger ref = `YYYY-MM`).
 *   warm_lead_offer  free user (not entitled to Pro, no Stripe subscription)
 *              whose latest paywall hit (paywall_hits, last 7 days) is 1h..3d
 *              old: 50% off the first Pro month (WELCOME50). Once per user,
 *              and mutually exclusive with limit_hit: whoever got one of
 *              the two never gets the other.
 *
 * One email per user per run, highest-priority template first
 * (warm_lead_offer > limit_hit > day7 > welcome > winback > pro_inactive),
 * oldest-eligible first, capped.
 */
import {
  warmLeadOfferEmail,
  type LifecycleEmailContent,
  type LifecycleTemplate,
  type LifecycleTemplateInput,
  type ScheduledLifecycleTemplate,
} from '@/lib/email/lifecycle';
import { isAdminEmail } from '@/lib/admin';
import { hasUnlimitedEdits } from '@/lib/paywall';
import { isProEntitled } from '@/lib/subscription/entitlement';

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
  /** user_usage.stripe_subscription_id / current_period_end: the entitlement rule reads them. */
  stripeSubscriptionId?: string | null;
  currentPeriodEnd?: string | null;
  /**
   * user_usage.current_period_start: written by the Stripe webhook when the
   * subscription starts and on every renewal. Null for rows from before the
   * period columns existed.
   */
  currentPeriodStart?: string | null;
  /** `unlimited` and other staff roles never get upsell email. */
  role: string | null;
  /** Earliest projects.created_at for the user, null when they have none. */
  firstProjectAt: string | null;
  /**
   * When the user's last Stripe subscription ended (ended_at / canceled_at),
   * null when unknown or still active. Loaded only for win-back candidates.
   */
  subscriptionEndedAt: string | null;
  /**
   * The latest of: any projects.updated_at (bumped on every file save), any
   * generated_documents.created_at, user_usage.updated_at (bumped by
   * increment_edit_count and consume_generation on every counted edit or
   * generation, for Pro and free alike) and user_usage.daily_reset_date
   * (free users only). Null when none is known. Loaded for the pro_inactive
   * rule.
   */
  lastActivityAt?: string | null;
  /**
   * The user's latest paywall_hits row of the last 7 days, null when none
   * (or the table is not there yet). Loaded for the warm_lead_offer rule.
   */
  lastPaywallHit?: PaywallHit | null;
}

export interface PaywallHit {
  /** ProFeature: 'ai-edit' | 'export' | 'generate'. */
  feature: string;
  /** PaywallReason: 'daily_limit' | 'pro_feature' | 'generate_quota'. */
  reason: string;
  createdAt: string;
}

export interface LifecycleSelectionInput {
  users: LifecycleUserRow[];
  /** Lower-cased addresses from email_suppressions. */
  suppressedEmails: Iterable<string>;
  /** user ids with email_preferences.marketing_opt_out = true. */
  optedOutUserIds: Iterable<string>;
  /**
   * Already-sent (user_id, template, ref) rows from lifecycle_emails. The
   * scheduled templates match on ref '' (once per user), pro_inactive on
   * the month ref (once per month); the billing-recovery rows never match.
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
   * Session id the email is about. The calendar month (`YYYY-MM`) for
   * pro_inactive, which goes out at most once a month. Absent ('' in the
   * table) for the other scheduled templates, which go out once per user.
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
  pro_inactive: { minIdleMs: 7 * DAY_MS },
  /**
   * Measured from the latest paywall hit: at least an hour (they may still
   * be deciding) and at most three days (the moment has passed). The loader
   * reads `lookbackMs` of paywall_hits.
   */
  warm_lead_offer: { minHitAgeMs: 1 * HOUR_MS, maxHitAgeMs: 3 * DAY_MS, lookbackMs: 7 * DAY_MS },
} as const;

/**
 * Templates a user gets at most one of, ever: the warm-lead discount and
 * the plain limit_hit upsell pitch the same moment.
 */
const MUTUALLY_EXCLUSIVE: Partial<Record<ScheduledLifecycleTemplate, ScheduledLifecycleTemplate>> = {
  warm_lead_offer: 'limit_hit',
  limit_hit: 'warm_lead_offer',
};

export const DEFAULT_SEND_CAP = 200;

/** Templates in the order a user who qualifies for several gets them. */
export const TEMPLATE_PRIORITY: readonly ScheduledLifecycleTemplate[] = [
  'warm_lead_offer',
  'limit_hit',
  'day7',
  'welcome',
  'winback',
  'pro_inactive',
];

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
 * Pro right now, by the one entitlement rule (lib/subscription/entitlement.ts)
 * applied to the user_usage row: Stripe is not consulted here, so a stale
 * `active` row whose period end has passed is not Pro, and a bare `is_pro`
 * flag grants nothing.
 */
export function isEntitledToPro(user: LifecycleUserRow, now: Date): boolean {
  return isProEntitled({
    row: {
      is_pro: user.isPro,
      subscription_status: user.subscriptionStatus,
      stripe_subscription_id: user.stripeSubscriptionId ?? null,
      current_period_end: user.currentPeriodEnd ?? null,
    },
    hasUnlimited: hasUnlimitedEdits(user.email),
    now,
  });
}

/** `YYYY-MM` of `now` (UTC): the pro_inactive ledger ref. */
export function monthRef(now: Date): string {
  return now.toISOString().slice(0, 7);
}

/** The ledger ref a scheduled template is keyed on this run. */
export function scheduledRef(template: ScheduledLifecycleTemplate, now: Date): string {
  return template === 'pro_inactive' ? monthRef(now) : '';
}

/**
 * Returns the timestamp that makes the user eligible for the template, or
 * null when the rule does not apply. Independent of suppression, opt-out and
 * dedupe, which `selectLifecycleCandidates` layers on top.
 */
export function eligibleSince(user: LifecycleUserRow, template: ScheduledLifecycleTemplate, now: Date): number | null {
  const nowMs = now.getTime();
  if (isStaff(user)) return null;

  if (template === 'pro_inactive') {
    // `unlimited` is a manual grant (staff, partners), not a plan to come back to.
    if (user.subscriptionStatus === 'unlimited' || !isEntitledToPro(user, now)) return null;
    const { minIdleMs } = LIFECYCLE_RULES.pro_inactive;
    // Someone who paid (or renewed) this week is not inactive, whatever the
    // activity tables say: a free user idle for ten days who buys Pro today
    // writes nothing to projects or generated_documents by buying. The quiet
    // week therefore starts no earlier than the period did.
    const periodStart = ms(user.currentPeriodStart ?? null);
    if (periodStart !== null && nowMs - periodStart < minIdleMs) return null;
    const lastActive = ms(user.lastActivityAt ?? null);
    if (lastActive === null || nowMs - lastActive < minIdleMs) return null;
    return Math.max(lastActive, periodStart ?? 0) + minIdleMs;
  }

  if (hasSubscription(user)) return null;

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
    case 'warm_lead_offer': {
      // A free user: not Pro by the entitlement rule, not on a manual grant,
      // and no Stripe subscription (live or not) the discount could collide with.
      if (user.subscriptionStatus === 'unlimited' || isEntitledToPro(user, now)) return null;
      if (user.stripeSubscriptionId) return null;
      const hit = ms(user.lastPaywallHit?.createdAt ?? null);
      if (hit === null) return null;
      const age = nowMs - hit;
      const { minHitAgeMs, maxHitAgeMs } = LIFECYCLE_RULES.warm_lead_offer;
      if (age < minHitAgeMs || age > maxHitAgeMs) return null;
      return hit;
    }
  }
}

/** "earlier today" / "yesterday" / "a couple of days ago" for a hit `ageMs` old. */
export function hitWhen(ageMs: number): string {
  if (ageMs < 12 * HOUR_MS) return 'earlier today';
  if (ageMs < 36 * HOUR_MS) return 'yesterday';
  return 'a couple of days ago';
}

/** The warm_lead_offer candidate's render and ledger payload, from the hit. */
function warmLeadExtras(user: LifecycleUserRow, now: Date): Pick<LifecycleCandidate, 'render' | 'payload'> {
  const hit = user.lastPaywallHit!;
  const when = hitWhen(now.getTime() - Date.parse(hit.createdAt));
  return {
    payload: { feature: hit.feature, reason: hit.reason, hit_at: hit.createdAt },
    render: (input) => warmLeadOfferEmail({ ...input, reason: hit.reason, feature: hit.feature, when }),
  };
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
  const sentKeys = new Set(Array.from(input.sent, (s) => `${s.userId}:${s.template}:${s.ref ?? ''}`));
  const enabled = new Set(input.enabledTemplates);
  const cap = input.cap ?? DEFAULT_SEND_CAP;

  const eligible: Record<ScheduledLifecycleTemplate, LifecycleCandidate[]> = {
    welcome: [],
    limit_hit: [],
    day7: [],
    winback: [],
    pro_inactive: [],
    warm_lead_offer: [],
  };

  const claimed = new Set<string>();
  for (const template of TEMPLATE_PRIORITY) {
    const ref = scheduledRef(template, input.now);
    for (const user of input.users) {
      if (!user.email) continue;
      const email = user.email.toLowerCase();
      if (suppressed.has(email) || optedOut.has(user.userId)) continue;
      if (sentKeys.has(`${user.userId}:${template}:${ref}`)) continue;
      const exclusive = MUTUALLY_EXCLUSIVE[template];
      if (exclusive && sentKeys.has(`${user.userId}:${exclusive}:${scheduledRef(exclusive, input.now)}`)) continue;
      const since = eligibleSince(user, template, input.now);
      if (since === null) continue;
      eligible[template].push({
        userId: user.userId,
        email,
        template,
        eligibleSince: since,
        ...(ref ? { ref } : {}),
        ...(template === 'warm_lead_offer' ? warmLeadExtras(user, input.now) : {}),
      });
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
