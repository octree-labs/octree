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
  ONBOARDING_START_OPTION_SELECTED: 'onboarding_start_option_selected',
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
  CANCEL_FLOW_OPENED: 'cancel_flow_opened',
  CANCEL_OFFER_ACCEPTED: 'cancel_offer_accepted',
  SUBSCRIPTION_PAUSED: 'subscription_paused',
  SUBSCRIPTION_RESUMED: 'subscription_resumed',
  SUBSCRIPTION_CANCEL_CONFIRMED: 'subscription_cancel_confirmed',
  IMPORT_COMPLETED: 'import_completed',
  AI_EDIT_SERVED: 'ai_edit_served',
  EDIT_LIMIT_HIT_SERVER: 'edit_limit_hit_server',
  LIFECYCLE_EMAIL_SENT: 'lifecycle_email_sent',
  CREDITS_PURCHASED: 'credits_purchased',
  GENERATE_ALLOWANCE_USED: 'generate_allowance_used',
  GENERATION_PURCHASED: 'generation_purchased',
} as const;

export type AnalyticsEvent = (typeof AnalyticsEvents)[keyof typeof AnalyticsEvents];

export type SignupProvider = 'email' | 'google' | (string & {});
export type OnboardingPlan = 'free' | 'pro';
export type PaywallFeature = 'ai-edit' | 'export' | 'generate';
export type PaywallReason = 'daily_limit' | 'pro_feature' | 'monthly_limit' | 'generate_quota';
/** What the paywall can sell: the subscription, or one generation credit. */
export type PaywallOffer = 'pro' | 'single';
/** Recurring plans. `weekly` is retired for new purchases but still appears on legacy subscriptions. */
export type CheckoutPlan = 'monthly' | 'annual' | 'semester' | 'weekly';
/**
 * Everything checkout can sell: the recurring plans, the one-time AI edit
 * credit pack and the one-off $2.99 generation credit.
 */
export type PurchasePlan = CheckoutPlan | 'credits_100' | 'generate_single';
/** How a generation was paid for (consume_generation in the database). */
export type GenerationKind = 'pro' | 'free' | 'credit';
export type CheckoutSource = 'onboarding' | 'paywall' | 'settings' | 'generate-preview' | 'toolbar' | 'buy';
/**
 * How a project came to exist. `upload` / `paste` / `sample` / `blank` are the
 * "Start with your document" options (onboarding step and the empty
 * dashboard); `import` is the dashboard Import dialog (ZIP); `generate` is the
 * AI generator; `blank` is also the dashboard "New Project" dialog.
 */
export type ProjectSource = 'upload' | 'paste' | 'sample' | 'blank' | 'generate' | 'import';
/**
 * What a new user picked on the "Start with your document" screen. The four
 * cards map 1:1 onto a ProjectSource; `generate` is the small text link and
 * `later` is "I'll do this later".
 */
export type StartOptionChoice = 'upload' | 'paste' | 'sample' | 'blank' | 'generate' | 'later';
export type StartOptionContext = 'onboarding' | 'dashboard';
export type CancelOffer = 'pause' | 'discount';
/** Stripe's `cancellation_details.feedback` enum. */
export type CancelFeedback =
  | 'unused'
  | 'too_expensive'
  | 'missing_features'
  | 'low_quality'
  | 'switched_service'
  | 'other';
export type ExportFormat = 'pdf' | 'zip';

export interface AnalyticsEventProperties {
  [AnalyticsEvents.SIGNUP_COMPLETED]: { provider: SignupProvider };
  [AnalyticsEvents.ONBOARDING_COMPLETED]: { plan: OnboardingPlan };
  [AnalyticsEvents.ONBOARDING_START_OPTION_SELECTED]: {
    option: StartOptionChoice;
    /** `onboarding`: the final onboarding step; `dashboard`: the empty dashboard. */
    context: StartOptionContext;
  };
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

  [AnalyticsEvents.PAYWALL_SHOWN]: {
    feature: PaywallFeature;
    reason: PaywallReason;
    offers?: PaywallOffer[];
  };
  [AnalyticsEvents.PAYWALL_DISMISSED]: { feature: PaywallFeature };
  [AnalyticsEvents.EDIT_LIMIT_HIT]: { is_pro: boolean; source: 'chat' | 'accept' };
  [AnalyticsEvents.CHECKOUT_STARTED]: {
    plan: PurchasePlan;
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
  [AnalyticsEvents.CANCEL_FLOW_OPENED]: {
    is_paused: boolean;
    has_discount: boolean;
    cancel_at_period_end: boolean;
  };
  [AnalyticsEvents.CANCEL_OFFER_ACCEPTED]: { offer: CancelOffer };
  [AnalyticsEvents.SUBSCRIPTION_PAUSED]: {
    months: number;
    /** Unix seconds; when Stripe resumes collection on its own. */
    resumes_at: number;
  };
  [AnalyticsEvents.SUBSCRIPTION_RESUMED]: {
    /** `user`: the Resume button; a scheduled resume is not an app event. */
    source: 'user';
  };
  [AnalyticsEvents.SUBSCRIPTION_CANCEL_CONFIRMED]: {
    feedback: CancelFeedback;
    has_comment: boolean;
  };
  [AnalyticsEvents.IMPORT_COMPLETED]: { source: string; title_length: number };
  [AnalyticsEvents.AI_EDIT_SERVED]: {
    model: string;
    is_pro: boolean;
    sample_rate: number;
  };
  [AnalyticsEvents.EDIT_LIMIT_HIT_SERVER]: { is_pro: boolean };
  /** One lifecycle/win-back email went out (app/api/cron/lifecycle). */
  [AnalyticsEvents.LIFECYCLE_EMAIL_SENT]: {
    template: 'welcome' | 'limit_hit' | 'day7' | 'winback';
  };
  /** A credit pack was paid for (Stripe webhook); `amount` in major units. */
  [AnalyticsEvents.CREDITS_PURCHASED]: {
    credits: number;
    amount: number | null;
    currency: string | null;
  };
  /** One generation started; `kind` says what paid for it. */
  [AnalyticsEvents.GENERATE_ALLOWANCE_USED]: {
    kind: GenerationKind;
    is_continuation: boolean;
  };
  /** A one-off generation credit was bought (Stripe webhook). */
  [AnalyticsEvents.GENERATION_PURCHASED]: {
    credits: number;
    amount: number | null;
    currency: string | null;
  };
}

/**
 * The legacy `annual` flag of createCheckoutSession: `true` buys the
 * $9.99/month price. `false` used to buy the retired $4.99/week price and is
 * now refused by the route, so it is still reported honestly as `weekly`.
 */
export function checkoutPlanFromAnnualFlag(annual: boolean): CheckoutPlan {
  return annual ? 'monthly' : 'weekly';
}

export function paywallReasonForFeature(feature: PaywallFeature): PaywallReason {
  return feature === 'ai-edit' ? 'daily_limit' : 'pro_feature';
}
