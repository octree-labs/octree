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
  `${PRO_MONTHLY_EDIT_LIMIT} AI edits per month (free: ${FREE_DAILY_EDIT_LIMIT} per day)`,
  'Export your project as PDF or ZIP',
  'Generate full documents from a prompt',
  'Unlimited projects and files',
] as const;
