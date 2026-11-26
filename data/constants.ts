// Subscription and usage limits
export const FREE_DAILY_EDIT_LIMIT = 5;
export const PRO_MONTHLY_EDIT_LIMIT = 500;

// Generate allowance: every account gets this many free generations, then
// Pro (unlimited) or a one-off credit. Keep in sync with
// supabase/migrations/20261018150000_generate_allowance.sql (consume_generation
// only ever grants one free generation) and lib/stripe-prices.ts.
export const FREE_GENERATION_ALLOWANCE = 1;
export const GENERATE_SINGLE_PRICE = {
  amount: 2.99,
  price: '$2.99',
  lookupKey: 'octree_generate_single',
  productName: 'One AI document generation',
} as const;

// One-off export unlock: PDF/ZIP export for ONE project, forever, without
// Pro. Keep in sync with lib/stripe-prices.ts (octree_export_single) and
// supabase/migrations/20261021150000_project_export_unlocks.sql.
export const EXPORT_SINGLE_PRICE = {
  amount: 4.99,
  price: '$4.99',
  lookupKey: 'octree_export_single',
  productName: 'Octree — Export this document',
} as const;

// Deadline Pass: a one-off purchase of PRO_PASS_DAYS days of Pro, no
// subscription. It sets user_usage.pro_until (stacking: a second pass
// extends the first) and everything that asks "is this user Pro" honours it
// (lib/subscription/entitlement.ts, increment_edit_count and
// consume_generation in the database). Quotas while it runs are Pro's:
// the monthly Pro allowance of PRO_MONTHLY_EDIT_LIMIT AI edits (the same
// monthly counter a subscription uses, so stacked passes in one month do not
// multiply it), unlimited generations, export, ATS check, the Pro API limits.
// Keep in sync with lib/stripe-prices.ts (octree_deadline_pass_7d) and
// supabase/migrations/20261130000000_deadline_pass.sql.
export const PRO_PASS_DAYS = 7;
export const DEADLINE_PASS_PRICE = {
  amount: 4.99,
  price: '$4.99',
  days: PRO_PASS_DAYS,
  lookupKey: 'octree_deadline_pass_7d',
  productName: 'Octree Deadline Pass (7 days of Pro)',
  label: 'Deadline Pass',
} as const;

/**
 * Where people reach a human about billing and refunds: the inbox the
 * contact form delivers to (app/api/contact) and the address lifecycle
 * emails are sent from (lib/email/client.ts).
 */
export const SUPPORT_EMAIL = 'basil@useoctree.com';

/** The money-back window shown with the offer (paywall, Checkout, /success, refund policy). */
export const MONEY_BACK_GUARANTEE_DAYS = 7;

// Free first export: every account's first PDF/ZIP export is free (recorded
// as a project_export_unlocks row with source 'free_first', so that project
// stays exportable); from the second export on the paywall applies. Kill
// switch: false restores the plain export paywall everywhere (client gate,
// GET /api/subscription-status and actions/claim-free-export.ts). Keep in
// sync with supabase/migrations/20261108120000_free_first_export.sql.
export const FREE_FIRST_EXPORT_ENABLED = true;

/**
 * Display copy for everything the app sells. The single source of truth for
 * labels and prices in the UI; the Stripe prices themselves are provisioned
 * from lib/stripe-prices.ts (same amounts, keyed by `lookup_key`).
 *
 * The $4.99/week plan is retired for new purchases and has no entry here;
 * existing weekly subscribers keep their subscription.
 */
export const PRO_PLANS = {
  monthly: {
    id: 'monthly',
    label: 'Monthly',
    amount: 9.99,
    price: '$9.99',
    interval: 'month',
    intervalLabel: 'per month',
    billingNote: 'Billed monthly. Cancel anytime.',
  },
  annual: {
    id: 'annual',
    label: 'Annual',
    amount: 79,
    price: '$79',
    interval: 'year',
    intervalLabel: 'per year',
    badge: 'Save 34%',
    billingNote: 'Just $6.58 a month, billed yearly. Cancel anytime.',
  },
  semester: {
    id: 'semester',
    label: 'Semester pass',
    amount: 29,
    price: '$29',
    interval: '4 months',
    intervalLabel: 'per 4 months',
    tagline: '4 months of Pro for the term',
    badge: 'Student offer',
    billingNote: 'Billed every 4 months. Cancel anytime.',
  },
} as const;

export type ProPlanId = keyof typeof PRO_PLANS;

/** One-time AI edit credit packs. Credits never expire. */
export const CREDIT_PACKS = {
  credits_100: {
    id: 'credits_100',
    credits: 100,
    amount: 5,
    price: '$5',
    label: '100 AI edits for $5',
    note: 'One-time purchase. Credits never expire and are used after your plan allowance.',
  },
} as const;

export type CreditPackId = keyof typeof CREDIT_PACKS;

export const DEFAULT_LATEX_CONTENT = (title: string) => `\\documentclass{article}
\\usepackage[utf8]{inputenc}
\\usepackage{amsmath}
\\usepackage{graphicx}

\\title{${title}}
\\author{Your Name}
\\date{\\today}

\\begin{document}

\\maketitle

\\section{Introduction}
This is the main document for your project: ${title}.

\\section{Getting Started}
You can start writing your LaTeX content here.

\\end{document}`;

export const DEFAULT_LATEX_CONTENT_FROM_FILENAME = (fileName: string) => {
  const cleanTitle = fileName.replace(/\.\w+$/, '');
  return `% ${fileName}
% Created on ${new Date().toISOString()}

\\documentclass{article}
\\usepackage[utf8]{inputenc}
\\usepackage{amsmath}
\\usepackage{amsfonts}
\\usepackage{amssymb}
\\usepackage{graphicx}
\\usepackage{geometry}
\\geometry{margin=1in}

\\title{${cleanTitle}}
\\author{}
\\date{\\today}

\\begin{document}

\\maketitle

\\section{Introduction}

Your content here.

\\end{document}`;
};

export const NON_LATEX_FILE_CONTENT = (fileName: string, projectTitle: string, fileSize: number | null, fileType: string | null) => `// File: ${fileName}
// Project: ${projectTitle}
// Size: ${fileSize || 'Unknown'} bytes
// Type: ${fileType || 'Unknown'}

// File content would be loaded here in a real implementation.
// This file type (${fileType || 'unknown'}) is not currently supported for editing.`;

// What the paywall dialog promises. Keep in sync with the limits above and
// with the gates in lib/subscription/features.ts.
export const PRO_FEATURES = [
  `${PRO_MONTHLY_EDIT_LIMIT} AI edits a month`,
  'Export your project as PDF or ZIP',
  'Generate full documents from a prompt',
  'Unlimited projects and files',
] as const;

/**
 * Kill switch for the post-compile "try one AI edit" card
 * (components/editor/first-edit-nudge.tsx). Set to `false` to stop showing it
 * to anyone; nothing else needs to change.
 *
 * Off since 2026-11: over three weeks it was shown 116 times, clicked 3 and
 * dismissed 43. The AI edit is offered at a compile error instead
 * (COMPILE_ERROR_FIX_ENABLED below); the card's code stays so it can be
 * switched back on.
 */
export const FIRST_EDIT_NUDGE_ENABLED = false;

/**
 * Kill switch for the "Fix with AI" offer on a failed compile
 * (lib/compile-error-fix.ts, hooks/use-compile-error-fix.ts): the error-kind
 * label, the button on the collapsed error bar, the prompt built from the
 * first TeX error lines and the `compile_error_fix_*` events. Set to `false`
 * to fall back to the plain "Fix with AI" button (log tail attached as a
 * selection, "Fix this error" sent).
 */
export const COMPILE_ERROR_FIX_ENABLED = true;

/**
 * Public compile API and MCP server (app/api/v1/compile, app/api/mcp):
 * compiles per account per UTC day. Pro, `unlimited` and allowlisted
 * accounts get the higher limit (lib/api/quota.ts).
 */
export const API_FREE_DAILY_COMPILES = 30;
export const API_PRO_DAILY_COMPILES = 1000;

/**
 * The MCP `check_latex` tool has its own daily counter (`api_usage_daily.checks`)
 * so validating edits does not use up the compile quota. It still runs the
 * compiler, so it is capped too, at a higher limit.
 */
export const API_FREE_DAILY_CHECKS = 200;
export const API_PRO_DAILY_CHECKS = 3000;

/**
 * The onboarding paywall: a new user picks a Pro plan and goes through
 * Stripe Checkout before reaching the dashboard, editor or /generate. There
 * is no "Continue with the free plan" on the plan step while this is on.
 *
 * Why it is back on (2026-11): from March to September about 2% of all
 * sign-ups became paying subscribers (Apr: 917 sign-ups -> 18 subs; Sep:
 * 256 -> 5) and nearly every Stripe checkout started on /onboarding. #393
 * (2026-10-18) added the free path and sign-up -> paid fell to ~0.6%
 * (about 2 subscriptions a month).
 *
 * Only users whose onboarding is not completed are gated
 * (lib/onboarding/paywall-gate.ts). Everyone with
 * user_usage.onboarding_completed = true (all older users, and everyone who
 * took the free path since 2026-10-18) is unaffected. The Stripe webhook
 * sets onboarding_completed for a paid subscription, as before.
 *
 * Switch it off without a code change by setting
 * NEXT_PUBLIC_ONBOARDING_PAYWALL=off (build-time: redeploy after changing
 * it): the free path and today's routing come back exactly as they were.
 */
export const ONBOARDING_PAYWALL_REQUIRED = process.env.NEXT_PUBLIC_ONBOARDING_PAYWALL !== 'off';

/**
 * Accounts created before this instant are never under the onboarding
 * paywall. Not every older account has onboarding_completed = true: a
 * tools.useoctree.com import (app/import/route.ts) has landed sign-ups in
 * the editor without setting it, and they have projects there. They keep
 * today's behaviour (the free path, editor and /generate open).
 */
export const ONBOARDING_PAYWALL_SINCE = '2026-11-25T00:00:00Z';
