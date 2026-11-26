/**
 * The `offer_v2` paywall (lib/offer-v2/variant.ts): copy and rules, pure and
 * browser-safe so they are unit tested and shared by the onboarding plan
 * step and the in-product paywall.
 *
 * Everything here is built from the app's real constants. The value stack
 * lists only features that exist (each line says where), prices come from
 * the visitor's regional catalog (lib/pricing-catalog.ts), and the only
 * deadline is the real one: the first-purchase offer (welcome50) shown for
 * the first OFFER_DEADLINE_HOURS after sign-up, counted from
 * auth.users.created_at. No invented numbers, values or timers.
 */

import {
  API_PRO_DAILY_COMPILES,
  COMPILE_ERROR_FIX_ENABLED,
  MONEY_BACK_GUARANTEE_DAYS,
  PRO_MONTHLY_EDIT_LIMIT,
  SUPPORT_EMAIL,
} from '@/data/constants';
import type { PricingCatalog } from '@/lib/pricing-catalog';

export const OFFER_HEADLINE = 'Finish your paper, thesis or CV in LaTeX before your deadline';
export const OFFER_SUBHEADLINE = 'The AI writes your LaTeX, fixes the errors and compiles it for you.';

/**
 * What Pro includes, as checkmarks. Each line is a shipped feature:
 * - AI edits: PRO_MONTHLY_EDIT_LIMIT, enforced by increment_edit_count.
 * - Compile-error fixes: "Fix with AI" on a failed compile
 *   (lib/compile-error-fix.ts), only while COMPILE_ERROR_FIX_ENABLED.
 * - Generate: unlimited for Pro (consume_generation answers `pro`).
 * - Resume redesign (app/api/resume/redesign) + ATS check (app/api/resume/ats, Pro only).
 * - Export: PDF/ZIP export is a Pro feature (lib/subscription/features.ts).
 * - API + MCP: app/api/v1/compile and app/api/mcp, API_PRO_DAILY_COMPILES a day on Pro.
 * Templates are not listed with a number: the app has no template gallery
 * to count beyond the resume templates.
 */
export function offerValueStack(flags: { compileErrorFix?: boolean } = {}): string[] {
  const compileErrorFix = flags.compileErrorFix ?? COMPILE_ERROR_FIX_ENABLED;
  return [
    `${PRO_MONTHLY_EDIT_LIMIT} AI edits a month: the AI writes and rewrites your LaTeX from a prompt`,
    ...(compileErrorFix ? ['One-click fixes when your document fails to compile'] : []),
    'Generate a full first draft from a prompt',
    'Resume redesign and an ATS check against any job description',
    'Unlimited PDF and ZIP export',
    `Compile API and MCP server for AI agents (${API_PRO_DAILY_COMPILES.toLocaleString('en-US')} compiles a day)`,
  ];
}

export const GUARANTEE_TITLE = `${MONEY_BACK_GUARANTEE_DAYS}-day money-back guarantee`;

export function guaranteeText(email: string = SUPPORT_EMAIL, days: number = MONEY_BACK_GUARANTEE_DAYS): string {
  return `If Octree doesn't get your document compiling within ${days} days, email ${email} for a full refund. No questions asked.`;
}

/** One line for Stripe Checkout (`custom_text.submit.message`, max 1200 chars) and /success. */
export function guaranteeLine(email: string = SUPPORT_EMAIL, days: number = MONEY_BACK_GUARANTEE_DAYS): string {
  return `${days}-day money-back guarantee: if Octree doesn't get your document compiling within ${days} days, email ${email} for a full refund, no questions asked.`;
}

/** A real customer quote. Supplied by the owner; none are invented. */
export interface Testimonial {
  quote: string;
  name: string;
  /** e.g. "PhD student, ETH Zurich". */
  role?: string;
}

/** Renders nothing while empty. */
export const TESTIMONIALS: Testimonial[] = [];

/** The plans the offer_v2 plan step sells, in display order. */
export const OFFER_PLANS = ['annual', 'monthly', 'semester', 'deadline_pass'] as const;
export type OfferPlan = (typeof OFFER_PLANS)[number];

export interface OfferPlanCopy {
  id: OfferPlan;
  label: string;
  /** The big number. */
  price: string;
  /** Under it: how it is billed. */
  detail: string;
  badge?: string;
  /** The primary button while this plan is selected. */
  cta: string;
}

/** "$6.58": a yearly price per month, from cents, rounded to the cent. */
export function perMonthFromAnnual(annualAmount: number): string {
  return `$${(Math.round(annualAmount * 100) / 1200).toFixed(2)}`;
}

/**
 * The plan cards at the visitor's price tier. `firstMonth` (the
 * first-purchase offer, still within its deadline) discounts the monthly
 * plan's first payment; it is applied at checkout with the same offer id.
 */
export function offerPlanCopy(
  catalog: Pick<PricingCatalog, 'proPlans' | 'deadlinePass'>,
  firstMonth?: { price: string; percentOff: number } | null
): Record<OfferPlan, OfferPlanCopy> {
  const { monthly, annual, semester } = catalog.proPlans;
  const pass = catalog.deadlinePass;
  return {
    annual: {
      id: 'annual',
      label: 'Annual',
      price: `${perMonthFromAnnual(annual.amount)}/mo`,
      detail: `billed ${annual.price}/yr. Cancel anytime.`,
      badge: annual.badge,
      cta: `Get Pro for ${annual.price}/yr`,
    },
    monthly: firstMonth
      ? {
          id: 'monthly',
          label: 'Monthly',
          price: `${firstMonth.price} first month`,
          detail: `then ${monthly.price}/mo. Cancel anytime.`,
          badge: `${firstMonth.percentOff}% off`,
          cta: `Get Pro for ${firstMonth.price}`,
        }
      : {
          id: 'monthly',
          label: 'Monthly',
          price: `${monthly.price}/mo`,
          detail: 'billed monthly. Cancel anytime.',
          cta: `Get Pro for ${monthly.price}/mo`,
        },
    semester: {
      id: 'semester',
      label: semester.label,
      price: semester.price,
      detail: `${semester.intervalLabel}, for students. Cancel anytime.`,
      badge: semester.badge,
      cta: `Get the Semester pass for ${semester.price}`,
    },
    deadline_pass: {
      id: 'deadline_pass',
      label: 'Deadline Pass',
      price: `${pass.price} once`,
      detail: `${pass.days} days of Pro. No subscription, nothing renews.`,
      cta: `Get ${pass.days} days of Pro for ${pass.price}`,
    },
  };
}

/** How long after sign-up the first-purchase offer is shown with its countdown. */
export const OFFER_DEADLINE_HOURS = 48;

/**
 * When the sign-up offer ends: `created_at` + OFFER_DEADLINE_HOURS, or null
 * when that has passed or the sign-up time is unknown (then no offer and no
 * countdown are shown). Eligibility (never bought anything) is decided
 * separately by lib/first-purchase-offer.ts.
 */
export function offerDeadline(
  createdAt: string | null | undefined,
  now: Date = new Date(),
  hours: number = OFFER_DEADLINE_HOURS
): Date | null {
  const created = Date.parse(createdAt ?? '');
  if (!Number.isFinite(created)) return null;
  const endsAt = created + hours * 60 * 60 * 1000;
  return endsAt > now.getTime() ? new Date(endsAt) : null;
}

/** "47h 59m", "3h 05m", "0h 01m" (never negative; under a minute shows 0h 00m). */
export function formatCountdown(msLeft: number): string {
  const totalMinutes = Math.max(0, Math.floor(msLeft / 60_000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours}h ${String(minutes).padStart(2, '0')}m`;
}

/** Fewer than this and the proof line is not shown (a small number reads as a weak signal). */
export const MIN_PROOF_COUNT = 50;

/** "1,234 documents started on Octree in the last 7 days", or null below MIN_PROOF_COUNT. */
export function proofLine(count: number | null | undefined): string | null {
  if (typeof count !== 'number' || !Number.isFinite(count) || count < MIN_PROOF_COUNT) return null;
  return `${Math.floor(count).toLocaleString('en-US')} documents started on Octree in the last 7 days`;
}

/** GET /api/offer. */
export interface OfferResponse {
  variant: 'control' | 'offer_v2';
  /** offer_v2 only: the first-purchase offer while its deadline runs. */
  deadline?: { offer: 'welcome50'; endsAt: string } | null;
  /** offer_v2 only: projects created in the last 7 days (cached), or null. */
  proof?: { count: number } | null;
}
