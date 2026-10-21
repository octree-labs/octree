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

import type { CheckoutOfferId } from '@/lib/checkout-offers';

export const AnalyticsEvents = {
  // --- Acquisition and activation (browser) ---
  SIGNUP_COMPLETED: 'signup_completed',
  ONBOARDING_COMPLETED: 'onboarding_completed',
  ONBOARDING_START_OPTION_SELECTED: 'onboarding_start_option_selected',
  PROJECT_CREATED: 'project_created',
  AI_EDIT_REQUESTED: 'ai_edit_requested',
  AI_EDIT_ACCEPTED: 'ai_edit_accepted',
  GENERATE_SUBMITTED: 'generate_submitted',
  GENERATE_COMPLETED: 'generate_completed',
  COMPILE_COMPLETED: 'compile_completed',
  EXPORT_CLICKED: 'export_clicked',
  IMPORT_PREVIEW_SHOWN: 'import_preview_shown',
  IMPORT_PREVIEW_SIGNUP_CLICKED: 'import_preview_signup_clicked',
  // Post-compile "try one AI edit" card (components/editor/first-edit-nudge.tsx)
  FIRST_EDIT_NUDGE_SHOWN: 'first_edit_nudge_shown',
  FIRST_EDIT_NUDGE_CLICKED: 'first_edit_nudge_clicked',
  FIRST_EDIT_NUDGE_DISMISSED: 'first_edit_nudge_dismissed',

  // --- Monetisation (browser) ---
  PAYWALL_SHOWN: 'paywall_shown',
  PAYWALL_DISMISSED: 'paywall_dismissed',
  EDIT_LIMIT_HIT: 'edit_limit_hit',
  DUNNING_BANNER_CLICKED: 'dunning_banner_clicked',
  // /buy?offer=<id>: the discount banner rendered (app/buy/buy-page-client.tsx).
  OFFER_BANNER_SHOWN: 'offer_banner_shown',

  // --- Server-side (posthog-node) ---
  // Captured by app/api/checkout-session once Stripe has opened the session,
  // so a browser that blocks analytics scripts still counts.
  CHECKOUT_STARTED: 'checkout_started',
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
  // Resend webhook (app/api/webhooks/resend): engagement with those emails.
  EMAIL_OPENED: 'email_opened',
  EMAIL_CLICKED: 'email_clicked',
  CREDITS_PURCHASED: 'credits_purchased',
  GENERATE_ALLOWANCE_USED: 'generate_allowance_used',
  GENERATION_PURCHASED: 'generation_purchased',
  // Billing recovery (Stripe webhook + lifecycle cron)
  CHECKOUT_ABANDONED: 'checkout_abandoned',
  CHECKOUT_RECOVERY_EMAIL_SENT: 'checkout_recovery_email_sent',
  PAYMENT_FAILED_EMAIL_SENT: 'payment_failed_email_sent',
  PRO_ENTITLEMENT_REVOKED: 'pro_entitlement_revoked',
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
export const CHECKOUT_SOURCES = ['onboarding', 'paywall', 'settings', 'generate-preview', 'toolbar', 'buy'] as const;
export type CheckoutSource = (typeof CHECKOUT_SOURCES)[number];
/** Validates a `source` sent by the browser before it reaches Stripe metadata. */
export function isCheckoutSource(value: unknown): value is CheckoutSource {
  return typeof value === 'string' && (CHECKOUT_SOURCES as readonly string[]).includes(value);
}
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
export type StartOptionChoice = 'upload' | 'paste' | 'sample' | 'blank' | 'resume' | 'generate' | 'later';
export type StartOptionContext = 'onboarding' | 'dashboard';
/** `?from=` on /generate; anything else (deep link, sidebar, bookmark) is `direct`. */
export type GenerateEntry = StartOptionContext | 'direct';
const GENERATE_ENTRIES: ReadonlySet<string> = new Set(['onboarding', 'dashboard']);
export function generateEntryFromParam(value: string | null | undefined): GenerateEntry {
  return value && GENERATE_ENTRIES.has(value) ? (value as GenerateEntry) : 'direct';
}
export function isGenerateEntry(value: unknown): value is GenerateEntry {
  return value === 'direct' || (typeof value === 'string' && GENERATE_ENTRIES.has(value));
}
/**
 * Why a generation attempt did not produce a document. Short categories
 * only; the raw message never leaves the browser.
 */
export type GenerateErrorKind =
  | 'aborted'
  | 'quota'
  | 'too_large'
  | 'request_failed'
  | 'no_stream'
  | 'stream_error'
  | 'incomplete'
  | 'empty'
  | 'unknown';
/**
 * Why a compile failed (lib/analytics/compile.ts). The LaTeX buckets come
 * from the first `! ` line of the log; the rest are transport failures that
 * never reached TeX (`request_rejected`: the service refused the request
 * itself, e.g. too large or an invalid file path; `network`: no usable
 * response at all).
 */
export type CompileErrorKind =
  | 'missing_package'
  | 'undefined_control_sequence'
  | 'missing_dollar'
  | 'missing_brace'
  | 'latex_error'
  | 'timeout'
  | 'service_unavailable'
  | 'unauthorized'
  | 'request_rejected'
  | 'network';
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
/** Every email the lifecycle ledger can record (lib/email/lifecycle). */
export type LifecycleEmailTemplate =
  | 'welcome'
  | 'limit_hit'
  | 'day7'
  | 'winback'
  | 'pro_inactive'
  | 'warm_lead_offer'
  | 'payment_failed'
  | 'payment_failed_reminder'
  | 'checkout_recovery'
  | 'checkout_recovery_offer';
/** Which control on the logged-out import landing started sign-up. */
export type ImportPreviewCta = 'google' | 'email' | 'login';
/** The one-click prompts on the post-compile nudge (lib/first-edit-nudge.ts). */
export type FirstEditNudgeSuggestion =
  | 'fix_formatting'
  | 'tighten_abstract'
  | 'tighten_introduction'
  | 'check_citations'
  | 'add_toc';

export interface AnalyticsEventProperties {
  [AnalyticsEvents.SIGNUP_COMPLETED]: { provider: SignupProvider };
  [AnalyticsEvents.ONBOARDING_COMPLETED]: {
    plan: OnboardingPlan;
    /** The "how did you find Octree" answer from the onboarding form (free plan only). */
    referral_source?: string;
    /**
     * Pro only, from the subscription's Checkout metadata
     * (lib/checkout-plans.ts): which plan was bought, which button in the
     * app started the checkout and, for /generate, how the visitor got there.
     */
    checkout_plan?: CheckoutPlan;
    source?: CheckoutSource;
    entry?: GenerateEntry;
  };
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
    /** Where the visit to /generate started; ties a submission back to the
     * `onboarding_start_option_selected` or dashboard card that sent it. */
    entry: GenerateEntry;
  };
  /**
   * One generation attempt ended (hooks/use-generate.ts): exactly one per
   * `generate_submitted` or retry, success or not. `duration_ms` runs from
   * the request leaving the browser to the document being saved.
   */
  [AnalyticsEvents.GENERATE_COMPLETED]: {
    success: boolean;
    duration_ms: number;
    is_continuation: boolean;
    error_kind?: GenerateErrorKind;
    /** Characters of LaTeX produced, on success. */
    latex_length?: number;
  };
  /**
   * One compile ended (hooks/use-editor-compilation.ts). Failures and the
   * browser's first FIRST_COMPILES_UNSAMPLED successes are always captured;
   * later successes 1 in N (`sample_rate` says which).
   */
  [AnalyticsEvents.COMPILE_COMPLETED]: {
    success: boolean;
    duration_ms: number;
    /** 1 when this capture was not sampled, otherwise the N of "1 in N". */
    sample_rate: number;
    /**
     * Successful compiles seen on this browser, counted in localStorage: on
     * success the ordinal of this one (1 = first ever success); on failure
     * the successes so far (0 = the user has never compiled successfully).
     * `null` when storage is unavailable.
     */
    compile_index: number | null;
    /**
     * Whether the compile service reported errors. Always true on failure;
     * true on success when a PDF came back alongside a failed TeX run (the
     * editor shows that PDF and no error UI). The `error_*` properties below
     * are present whenever this is true.
     */
    had_errors: boolean;
    error_kind?: CompileErrorKind;
    /** First `! ` line of the log (or the error message), at most 200 chars. */
    error_summary?: string;
    /** Number of `! ` lines in the log, when a log came back. */
    error_count?: number;
    /** HTTP status of the compile response, when there was one. */
    http_status?: number;
  };
  [AnalyticsEvents.EXPORT_CLICKED]: { format: ExportFormat; allowed: boolean };
  /**
   * The logged-out /import/start landing finished loading its PDF preview.
   * `source` is the draft's origin slug (e.g. `tools:templates:x`); `ok` is
   * false when the compile failed or the preview was unavailable.
   */
  [AnalyticsEvents.IMPORT_PREVIEW_SHOWN]: {
    source: string;
    ok: boolean;
    reason?: 'compile_failed' | 'unavailable' | 'too_large' | 'unsupported' | 'not_found';
  };
  /** A sign-up / log-in control on that landing was clicked. */
  [AnalyticsEvents.IMPORT_PREVIEW_SIGNUP_CLICKED]: {
    source: string;
    method: ImportPreviewCta;
    preview_ok: boolean | null;
  };
  /**
   * The "Your PDF is ready. Try one AI edit on it" card after a user's first
   * successful compile; shown at most once per user.
   */
  [AnalyticsEvents.FIRST_EDIT_NUDGE_SHOWN]: {
    /** Which three prompts were offered, in order. */
    suggestions: FirstEditNudgeSuggestion[];
  };
  [AnalyticsEvents.FIRST_EDIT_NUDGE_CLICKED]: { suggestion: FirstEditNudgeSuggestion };
  [AnalyticsEvents.FIRST_EDIT_NUDGE_DISMISSED]: Record<string, never>;

  [AnalyticsEvents.PAYWALL_SHOWN]: {
    feature: PaywallFeature;
    reason: PaywallReason;
    offers?: PaywallOffer[];
    /** The first-purchase offer shown on the Pro offer (lib/first-purchase-offer.ts); absent when none. */
    offer?: CheckoutOfferId;
  };
  [AnalyticsEvents.PAYWALL_DISMISSED]: { feature: PaywallFeature; reason?: PaywallReason };
  [AnalyticsEvents.EDIT_LIMIT_HIT]: { is_pro: boolean; source: 'chat' | 'accept' };
  /**
   * A Stripe Checkout Session was opened (app/api/checkout-session, server
   * side). `source` is 'unknown' only for a request that sent no valid
   * source; every in-app button sends one.
   */
  [AnalyticsEvents.CHECKOUT_STARTED]: {
    plan: PurchasePlan;
    source: CheckoutSource | 'unknown';
    entry?: GenerateEntry;
    with_trial: boolean;
    mode: 'subscription' | 'payment';
    /** Stripe price lookup_key (lib/stripe-prices.ts). */
    price_lookup_key: string;
    /** The Checkout Session id, to join with `subscription_started` / `checkout_abandoned`. */
    session_id: string;
    captured: 'server';
    /**
     * The checkout offer applied to the session (lib/checkout-offers.ts);
     * undefined when none was asked for, or Stripe refused it.
     */
    offer?: CheckoutOfferId;
    /** Present when an offer was asked for: whether the discount made it onto the session. */
    offer_applied?: boolean;
  };
  /**
   * The /buy offer banner. `auto: true` when the page applied the
   * first-purchase offer itself (no `?offer=` in the URL).
   */
  [AnalyticsEvents.OFFER_BANNER_SHOWN]: { offer: CheckoutOfferId; auto?: boolean };
  /** The past-due banner's "Update card" was clicked (opens the billing portal). */
  [AnalyticsEvents.DUNNING_BANNER_CLICKED]: { location: 'dashboard' | 'editor' };

  [AnalyticsEvents.SUBSCRIPTION_STARTED]: {
    plan: CheckoutPlan | 'unknown';
    interval: 'month' | 'week' | 'year' | 'day' | 'unknown';
    amount: number | null;
    currency: string | null;
    /** Which button started the checkout (Checkout Session metadata). */
    source?: CheckoutSource;
    /** For a checkout from /generate: how the visitor reached /generate. */
    entry?: GenerateEntry;
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
  /** One lifecycle email went out (app/api/cron/lifecycle, or the Stripe webhook for billing recovery). */
  [AnalyticsEvents.LIFECYCLE_EMAIL_SENT]: {
    template: LifecycleEmailTemplate;
  };
  /** Resend reported an open of a ledgered email (app/api/webhooks/resend). */
  [AnalyticsEvents.EMAIL_OPENED]: {
    template: LifecycleEmailTemplate;
  };
  /** Resend reported a click; `link` is hostname + path only, never the query. */
  [AnalyticsEvents.EMAIL_CLICKED]: {
    template: LifecycleEmailTemplate;
    link?: string;
  };
  /** A Checkout Session expired unpaid (Stripe webhook); `amount` in major units. */
  [AnalyticsEvents.CHECKOUT_ABANDONED]: {
    plan: PurchasePlan | 'unknown';
    amount: number | null;
    currency: string | null;
    mode: 'subscription' | 'payment' | 'setup';
    /** Whether Stripe issued a recovery URL for it. */
    recoverable: boolean;
  };
  /** A recovery email for an expired checkout went out. */
  [AnalyticsEvents.CHECKOUT_RECOVERY_EMAIL_SENT]: {
    template: 'checkout_recovery' | 'checkout_recovery_offer';
    plan: PurchasePlan | 'unknown';
    /** The offer email carried a promotion code. */
    has_offer: boolean;
  };
  /** A dunning email went out; `amount` in major units. */
  [AnalyticsEvents.PAYMENT_FAILED_EMAIL_SENT]: {
    template: 'payment_failed' | 'payment_failed_reminder';
    amount: number | null;
    currency: string | null;
    /** Stripe has another automatic retry scheduled. */
    has_retry: boolean;
    /**
     * What sent a `payment_failed` notice: the cron's sweep of past-due
     * subscriptions that never got one. Absent for the webhook's send and
     * the reminder (additive: existing insights keep matching).
     */
    trigger?: 'sweep';
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
  /**
   * GET /api/subscription-status found `user_usage` still claiming Pro for
   * a subscription Stripe reports as gone, and rewrote the row to the free
   * tier (lib/subscription/entitlement.ts). `missing` is a Stripe 404.
   */
  [AnalyticsEvents.PRO_ENTITLEMENT_REVOKED]: {
    reason: 'canceled' | 'incomplete_expired' | 'missing';
    previous_status: string | null;
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
