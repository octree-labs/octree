/**
 * The PostHog event catalogue. Every `capture` in the app (browser or server)
 * takes its name from here so the funnel
 *
 *   sign-up -> onboarding -> first project -> first AI edit -> paywall
 *   -> checkout -> paid -> churn
 *
 * is built from names that cannot drift. Property types are declared next to
 * the names; `track` (lib/analytics/track.ts) and `captureServerEvent`
 * (lib/posthog-server.ts) are typed against them.
 *
 * Privacy: no event carries LaTeX source, prompts, file names or emails.
 * Emails reach PostHog only through `identify`.
 */

export const AnalyticsEvents = {
  // --- Acquisition and activation (browser) ---
  SIGNUP_COMPLETED: 'signup_completed',
  ONBOARDING_COMPLETED: 'onboarding_completed',
  PROJECT_CREATED: 'project_created',
  AI_EDIT_REQUESTED: 'ai_edit_requested',
  AI_EDIT_ACCEPTED: 'ai_edit_accepted',
  GENERATE_SUBMITTED: 'generate_submitted',
  COMPILE_COMPLETED: 'compile_completed',
  EXPORT_CLICKED: 'export_clicked',

  // --- Monetisation (browser) ---
  PAYWALL_SHOWN: 'paywall_shown',
  PAYWALL_DISMISSED: 'paywall_dismissed',
  EDIT_LIMIT_HIT: 'edit_limit_hit',
  CHECKOUT_STARTED: 'checkout_started',

  // --- Server-side (posthog-node) ---
  SUBSCRIPTION_STARTED: 'subscription_started',
  SUBSCRIPTION_CANCELED: 'subscription_canceled',
  SUBSCRIPTION_PAST_DUE: 'subscription_past_due',
  SUBSCRIPTION_REACTIVATED: 'subscription_reactivated',
  IMPORT_COMPLETED: 'import_completed',
  AI_EDIT_SERVED: 'ai_edit_served',
  EDIT_LIMIT_HIT_SERVER: 'edit_limit_hit_server',
} as const;

export type AnalyticsEvent = (typeof AnalyticsEvents)[keyof typeof AnalyticsEvents];

export type SignupProvider = 'email' | 'google' | (string & {});
export type OnboardingPlan = 'free' | 'pro';
export type PaywallFeature = 'ai-edit' | 'export' | 'generate';
export type PaywallReason = 'daily_limit' | 'pro_feature' | 'monthly_limit';
export type CheckoutPlan = 'monthly' | 'weekly';
export type CheckoutSource = 'onboarding' | 'paywall' | 'settings' | 'generate-preview';
export type ProjectSource = 'dashboard' | 'import' | 'generate';
export type ExportFormat = 'pdf' | 'zip';

export interface AnalyticsEventProperties {
  [AnalyticsEvents.SIGNUP_COMPLETED]: { provider: SignupProvider };
  [AnalyticsEvents.ONBOARDING_COMPLETED]: { plan: OnboardingPlan };
  [AnalyticsEvents.PROJECT_CREATED]: { source: ProjectSource };
  [AnalyticsEvents.AI_EDIT_REQUESTED]: {
    has_selection: boolean;
    attachment_count: number;
  };
  [AnalyticsEvents.AI_EDIT_ACCEPTED]: { count: number; mode: 'single' | 'all' };
  [AnalyticsEvents.GENERATE_SUBMITTED]: {
    attachment_count: number;
    is_continuation: boolean;
  };
  [AnalyticsEvents.COMPILE_COMPLETED]: {
    success: boolean;
    duration_ms: number;
    /** 1 in N successes are captured; failures are always captured. */
    sample_rate: number;
  };
  [AnalyticsEvents.EXPORT_CLICKED]: { format: ExportFormat; allowed: boolean };

  [AnalyticsEvents.PAYWALL_SHOWN]: { feature: PaywallFeature; reason: PaywallReason };
  [AnalyticsEvents.PAYWALL_DISMISSED]: { feature: PaywallFeature };
  [AnalyticsEvents.EDIT_LIMIT_HIT]: { is_pro: boolean; source: 'chat' | 'accept' };
  [AnalyticsEvents.CHECKOUT_STARTED]: {
    plan: CheckoutPlan;
    source: CheckoutSource;
    with_trial: boolean;
  };

  [AnalyticsEvents.SUBSCRIPTION_STARTED]: {
    plan: CheckoutPlan | 'unknown';
    interval: 'month' | 'week' | 'year' | 'day' | 'unknown';
    amount: number | null;
    currency: string | null;
  };
  [AnalyticsEvents.SUBSCRIPTION_CANCELED]: {
    /** `at_period_end`: user turned off renewal; `deleted`: Stripe ended it. */
    kind: 'at_period_end' | 'deleted';
    status: string;
  };
  [AnalyticsEvents.SUBSCRIPTION_PAST_DUE]: { status: string };
  [AnalyticsEvents.SUBSCRIPTION_REACTIVATED]: {
    previous_status: string | null;
    status: string;
  };
  [AnalyticsEvents.IMPORT_COMPLETED]: { source: string; title: string };
  [AnalyticsEvents.AI_EDIT_SERVED]: {
    model: string;
    is_pro: boolean;
    sample_rate: number;
  };
  [AnalyticsEvents.EDIT_LIMIT_HIT_SERVER]: { is_pro: boolean };
}

/**
 * The `annual` flag of createCheckoutSession is historical: `true` buys the
 * $9.99/month price and `false` the $4.99/week price (see
 * app/api/checkout-session/route.ts). Analytics names the plan honestly.
 */
export function checkoutPlanFromAnnualFlag(annual: boolean): CheckoutPlan {
  return annual ? 'monthly' : 'weekly';
}

export function paywallReasonForFeature(feature: PaywallFeature): PaywallReason {
  return feature === 'ai-edit' ? 'daily_limit' : 'pro_feature';
}
