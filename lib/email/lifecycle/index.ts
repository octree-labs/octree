import { PRO_MONTHLY_EDIT_LIMIT, PRO_PLANS } from '@/data/constants';
import { WARM_LEAD_OFFER, warmLeadOfferUrl } from '@/lib/checkout-offers';
import { join, link, p, renderLifecycleEmail, type LifecycleEmailContent } from './layout';

export type { LifecycleEmailContent } from './layout';

/**
 * The scheduled templates: picked by the daily cron from the user's state,
 * at most once per user, rendered from the app URLs alone.
 */
export const SCHEDULED_LIFECYCLE_TEMPLATES = ['welcome', 'limit_hit', 'day7', 'winback', 'pro_inactive', 'warm_lead_offer'] as const;
export type ScheduledLifecycleTemplate = (typeof SCHEDULED_LIFECYCLE_TEMPLATES)[number];

/**
 * The billing-recovery templates: triggered by a Stripe object (an invoice
 * that failed, a Checkout Session that expired), keyed on that object's id
 * in the ledger (`lifecycle_emails.ref`) and rendered with its data.
 * payment_failed* are transactional (no marketing opt-out applies);
 * checkout_recovery* are marketing.
 */
export const BILLING_RECOVERY_TEMPLATES = [
  'payment_failed',
  'payment_failed_reminder',
  'checkout_recovery',
  'checkout_recovery_offer',
] as const;
export type BillingRecoveryTemplate = (typeof BILLING_RECOVERY_TEMPLATES)[number];

export const LIFECYCLE_TEMPLATES = [...SCHEDULED_LIFECYCLE_TEMPLATES, ...BILLING_RECOVERY_TEMPLATES] as const;
export type LifecycleTemplate = ScheduledLifecycleTemplate | BillingRecoveryTemplate;

export function isScheduledTemplate(template: string): template is ScheduledLifecycleTemplate {
  return (SCHEDULED_LIFECYCLE_TEMPLATES as readonly string[]).includes(template);
}

export function isBillingRecoveryTemplate(template: string): template is BillingRecoveryTemplate {
  return (BILLING_RECOVERY_TEMPLATES as readonly string[]).includes(template);
}

/** Account notices that go out regardless of the marketing opt-out. */
export function isTransactionalTemplate(template: string): boolean {
  return template === 'payment_failed' || template === 'payment_failed_reminder';
}

export interface LifecycleTemplateInput {
  /** App origin without trailing slash, e.g. https://app.useoctree.com */
  appUrl: string;
  /** Templates site origin without trailing slash. */
  toolsUrl: string;
  unsubscribeUrl: string;
}

const PRO_LINE = `Pro is ${PRO_PLANS.monthly.price}/month: ${PRO_MONTHLY_EDIT_LIMIT} AI edits a month, PDF and ZIP export, and Generate (a full document from a prompt). Cancel anytime.`;

export function welcomeEmail(input: LifecycleTemplateInput): LifecycleEmailContent {
  const templates = `${input.toolsUrl}/templates`;
  return renderLifecycleEmail({
    template: 'welcome',
    subject: 'Start with a template',
    preheader: 'Three LaTeX templates that open straight in Octree.',
    paragraphs: [
      p("Hi, Basil here. I build Octree. You signed up but haven't started a project yet, so here is the fastest way in: pick a template and open it in the editor."),
      join(
        link("Jake's Resume", `${templates}/jakes-resume`),
        ' - the one-page engineering resume most people use.'
      ),
      join(link('NeurIPS 2027', `${templates}/neurips-2027`), ' - the conference paper style file, ready to compile.'),
      join(link('Thesis', `${templates}/thesis`), ' - chapters, bibliography and front matter already wired up.'),
      p('Each page has an "Open in Octree" button. Or start blank: the editor compiles as you type and the AI can fix errors or rewrite a paragraph when you ask.'),
      p('Reply to this email if anything is confusing. I read every one.'),
    ],
    cta: { label: 'Open the editor', href: `${input.appUrl}/` },
    unsubscribeUrl: input.unsubscribeUrl,
  });
}

export function limitHitEmail(input: LifecycleTemplateInput): LifecycleEmailContent {
  return renderLifecycleEmail({
    template: 'limit_hit',
    subject: "You've used your free AI edits",
    preheader: `Pro: ${PRO_MONTHLY_EDIT_LIMIT} AI edits a month, export, Generate. ${PRO_PLANS.monthly.price}/month.`,
    paragraphs: [
      p('Basil here. You hit the free limit on AI edits in Octree, which means you actually used it. Thanks.'),
      p(`Free stays free: 5 AI edits a day, unlimited compiles. If you want more, ${PRO_LINE}`),
      p('Upgrading takes about a minute and the button below opens the checkout inside the editor.'),
    ],
    cta: { label: 'Upgrade to Pro', href: `${input.appUrl}/?upgrade=1` },
    unsubscribeUrl: input.unsubscribeUrl,
  });
}

export function day7Email(input: LifecycleTemplateInput): LifecycleEmailContent {
  return renderLifecycleEmail({
    template: 'day7',
    subject: 'One Octree tip: jump from PDF to source',
    preheader: 'Double-click the PDF to land on the exact line of LaTeX.',
    paragraphs: [
      p("Basil here. You've had Octree for a week, so one tip that most people miss:"),
      p('Double-click anywhere in the compiled PDF and the editor jumps to that line of source. Double-click a line in the editor and the PDF scrolls to it. SyncTeX is on for every project, including free ones.'),
      p(`If you reach for the AI a lot: ${PRO_LINE}`),
    ],
    cta: { label: 'Open your projects', href: `${input.appUrl}/` },
    unsubscribeUrl: input.unsubscribeUrl,
  });
}

export function winbackEmail(input: LifecycleTemplateInput): LifecycleEmailContent {
  return renderLifecycleEmail({
    template: 'winback',
    subject: "What's changed in Octree since you left",
    preheader: 'Free editor access, faster compiles, new templates and converters.',
    paragraphs: [
      p('Basil here. You had Octree Pro for a while and cancelled, which is fair. A few things are different now, so one short note and then I will leave you alone:'),
      p('The editor no longer needs a subscription. Every account gets the editor, compiles and 5 AI edits a day for free, so your projects are still there and still work.'),
      p('Compiles are faster: a dedicated compile service replaced the old serverless one, and PDF-to-source jumping (SyncTeX) is on everywhere.'),
      join(
        'New templates and converters on ',
        link('tools.useoctree.com', input.toolsUrl),
        ': resume, thesis and conference templates that open in Octree, plus converters for Markdown, HTML, MathML and Mermaid.'
      ),
      p(`${PRO_LINE} Your old account and projects pick up where they were.`),
    ],
    cta: { label: 'Come back to Pro', href: `${input.appUrl}/?upgrade=1` },
    unsubscribeUrl: input.unsubscribeUrl,
  });
}

/**
 * To a paying subscriber who has not touched Octree for a week. No pitch
 * (they already pay): three things that take two minutes each, one button.
 */
export function proInactiveEmail(input: LifecycleTemplateInput): LifecycleEmailContent {
  return renderLifecycleEmail({
    template: 'pro_inactive',
    subject: 'Your Octree Pro plan is waiting',
    preheader: 'Three two-minute things you can do with it today.',
    paragraphs: [
      p("Basil here. You're on Octree Pro and haven't opened it in about a week. That's fine; documents come in waves. If you have a spare two minutes, any of these pays for itself:"),
      p('Import an existing .tex file or a ZIP (an Overleaf export works as-is): New Project on the dashboard, upload it, and it compiles right away.'),
      p('Fix a compile error with the AI: open a project whose build fails and press "Fix with AI" on the error. It edits the line; you accept or reject.'),
      p('Export a finished PDF: the Export button in the editor gives you the PDF, or the full source as a ZIP.'),
      p("If none of that is useful right now, nothing to do. Reply if there's something you expected Octree to do and it doesn't; that is the most useful email I get."),
    ],
    cta: { label: 'Open Octree', href: `${input.appUrl}/` },
    unsubscribeUrl: input.unsubscribeUrl,
  });
}

/** Which paywall the warm lead ran into; picks the subject and the first line. */
export type WarmLeadVariant = 'daily_limit' | 'export' | 'generate';

/**
 * Maps a paywall hit (paywall_hits.reason / feature) to the copy variant.
 * Anything unknown reads as the export / Pro feature paywall.
 */
export function warmLeadVariant(reason: string | null | undefined, feature?: string | null): WarmLeadVariant {
  if (reason === 'daily_limit') return 'daily_limit';
  if (reason === 'generate_quota' || feature === 'generate') return 'generate';
  return 'export';
}

const WARM_LEAD_COPY: Record<WarmLeadVariant, { subject: string; ranInto: string }> = {
  daily_limit: {
    subject: "You hit the daily AI edit limit — here's 50% off your first month",
    ranInto: 'the daily AI edit limit',
  },
  export: {
    subject: 'Your PDF is one step away — 50% off your first month',
    ranInto: 'the paywall when exporting your PDF',
  },
  generate: {
    subject: 'Finish that document — 50% off your first month',
    ranInto: 'the end of the free generation',
  },
};

export interface WarmLeadOfferEmailInput extends LifecycleTemplateInput {
  /** paywall_hits.reason of the latest hit; drives the subject. */
  reason?: string | null;
  feature?: string | null;
  /** When the hit was, in words ("yesterday"); defaults to "recently". */
  when?: string;
}

/**
 * To a free user who hit a paywall and did not buy: a personal note with
 * 50% off the first Pro month. The button lands on /buy?offer=welcome50,
 * which applies the WELCOME50 promotion code at checkout
 * (lib/checkout-offers.ts).
 */
export function warmLeadOfferEmail(input: WarmLeadOfferEmailInput): LifecycleEmailContent {
  const copy = WARM_LEAD_COPY[warmLeadVariant(input.reason, input.feature)];
  const offer = WARM_LEAD_OFFER;
  return renderLifecycleEmail({
    template: 'warm_lead_offer',
    subject: copy.subject,
    preheader: `${offer.label} of Octree Pro. Code ${offer.promotionCode}.`,
    paragraphs: [
      p(`Hi, I'm Basil, I build Octree. I saw you ran into ${copy.ranInto} ${input.when ?? 'recently'}. That's a frustrating place to stop.`),
      p(`If you want to keep going, here's ${offer.percentOff}% off your first month of Pro (${PRO_MONTHLY_EDIT_LIMIT} AI edits a month, PDF export, no daily cap):`),
    ],
    cta: { label: `Claim ${offer.percentOff}% off`, href: warmLeadOfferUrl(input.appUrl) },
    closing: [
      `Use code ${offer.promotionCode} at checkout if the discount doesn't show.`,
      'If something else was in the way, just reply and tell me — one line is enough.',
      'Basil',
    ],
    unsubscribeUrl: input.unsubscribeUrl,
  });
}

export const LIFECYCLE_EMAILS: Record<ScheduledLifecycleTemplate, (input: LifecycleTemplateInput) => LifecycleEmailContent> = {
  welcome: welcomeEmail,
  limit_hit: limitHitEmail,
  day7: day7Email,
  winback: winbackEmail,
  pro_inactive: proInactiveEmail,
  warm_lead_offer: warmLeadOfferEmail,
};

/**
 * Renders a scheduled template. The billing-recovery templates need their
 * Stripe data and are rendered through the functions below; a candidate for
 * one of them carries its own `render` (lib/lifecycle/send.ts).
 */
export function renderLifecycleTemplate(template: LifecycleTemplate, input: LifecycleTemplateInput): LifecycleEmailContent {
  if (!isScheduledTemplate(template)) {
    throw new Error(`lifecycle template ${template} needs its billing data to render`);
  }
  return LIFECYCLE_EMAILS[template](input);
}

// --- Billing recovery ---------------------------------------------------------

/** "$9.99" from Stripe minor units; falls back to the plan price when unknown. */
export function formatMoney(amountCents: number | null | undefined, currency: string | null | undefined): string | null {
  if (typeof amountCents !== 'number' || !Number.isFinite(amountCents)) return null;
  const code = (currency ?? 'usd').toUpperCase();
  const major = amountCents / 100;
  if (code === 'USD') return `$${major.toFixed(2)}`;
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: code }).format(major);
  } catch {
    return `${major.toFixed(2)} ${code}`;
  }
}

function formatDay(unixSeconds: number | null | undefined): string | null {
  if (typeof unixSeconds !== 'number' || !Number.isFinite(unixSeconds) || unixSeconds <= 0) return null;
  return new Date(unixSeconds * 1000).toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

export interface PaymentFailedEmailInput {
  /** Stripe minor units of the open invoice; null when unknown. */
  amountCents: number | null;
  currency: string | null;
  /** Stripe's hosted invoice page: pay now or change the card. */
  hostedInvoiceUrl: string | null;
  /** Unix seconds of Stripe's next automatic retry (Smart Retries); null when none is scheduled. */
  nextPaymentAttempt: number | null;
  /** Where the billing-portal link goes (the app's settings page). */
  billingUrl: string;
}

function paymentFailedBody(input: PaymentFailedEmailInput, reminder: boolean) {
  const amount = formatMoney(input.amountCents, input.currency) ?? `${PRO_PLANS.monthly.price}`;
  const retry = formatDay(input.nextPaymentAttempt);
  const paragraphs = [
    p(
      reminder
        ? `Basil here. A few days ago the ${amount} payment for Octree Pro failed, and it still has not gone through.`
        : `Basil here. The ${amount} payment for Octree Pro did not go through. That is usually an expired card or a bank decline, nothing on your side to worry about.`
    ),
    p(
      retry
        ? `Stripe will try the card again on ${retry}. To keep Pro without the wait, pay the invoice or update your card now; it takes a minute.`
        : 'There is no further automatic retry scheduled, so Pro stays off until the invoice is paid. Paying it or updating your card takes a minute.'
    ),
    p(
      reminder
        ? 'If you meant to let Pro lapse, ignore this and the subscription will end on its own. Your projects stay.'
        : 'If the payment keeps failing the subscription ends and the account drops to the free plan. Your projects stay either way.'
    ),
  ];
  return { amount, paragraphs };
}

export function paymentFailedEmail(input: PaymentFailedEmailInput): LifecycleEmailContent {
  const { amount, paragraphs } = paymentFailedBody(input, false);
  return renderLifecycleEmail({
    template: 'payment_failed',
    subject: "Your Octree Pro payment didn't go through",
    preheader: `The ${amount} payment failed. Update your card to keep Pro.`,
    paragraphs,
    cta: { label: 'Pay or update card', href: input.hostedInvoiceUrl ?? input.billingUrl },
    secondary: { label: 'Manage billing in Octree', href: input.billingUrl },
  });
}

export function paymentFailedReminderEmail(input: PaymentFailedEmailInput): LifecycleEmailContent {
  const { amount, paragraphs } = paymentFailedBody(input, true);
  return renderLifecycleEmail({
    template: 'payment_failed_reminder',
    subject: 'Reminder: Octree Pro payment still failing',
    preheader: `The ${amount} payment is still open. Update your card to keep Pro.`,
    paragraphs,
    cta: { label: 'Pay or update card', href: input.hostedInvoiceUrl ?? input.billingUrl },
    secondary: { label: 'Manage billing in Octree', href: input.billingUrl },
  });
}

export interface CheckoutRecoveryEmailInput {
  /** Stripe's recovery URL: reopens the expired Checkout Session. */
  recoveryUrl: string;
  /** What was in the cart (`metadata.plan`), for the copy. */
  plan: string | null;
  amountCents: number | null;
  currency: string | null;
  /** Promotion code to mention (the offer email); null means no offer. */
  promoCode: string | null;
  unsubscribeUrl: string;
}

function cartLabel(input: Pick<CheckoutRecoveryEmailInput, 'plan' | 'amountCents' | 'currency'>): string {
  const amount = formatMoney(input.amountCents, input.currency);
  switch (input.plan) {
    case 'monthly':
      return `Octree Pro (${amount ?? PRO_PLANS.monthly.price}/month)`;
    case 'annual':
      return `Octree Pro annual (${amount ?? PRO_PLANS.annual.price}/year)`;
    case 'semester':
      return `the Octree semester pass (${amount ?? PRO_PLANS.semester.price} for 4 months)`;
    case 'credits_100':
      return `100 AI edits (${amount ?? '$5'})`;
    case 'generate_single':
      return `one document generation (${amount ?? '$2.99'})`;
    default:
      return amount ? `Octree Pro (${amount})` : 'Octree Pro';
  }
}

export function checkoutRecoveryEmail(input: CheckoutRecoveryEmailInput): LifecycleEmailContent {
  const cart = cartLabel(input);
  return renderLifecycleEmail({
    template: 'checkout_recovery',
    subject: 'Your Octree checkout is still open',
    preheader: `Pick up where you left off: ${cart}.`,
    paragraphs: [
      p(`Basil here. You started checking out for ${cart} and did not finish. No problem; the link below reopens the same checkout, nothing was charged.`),
      p(`Pro is ${PRO_MONTHLY_EDIT_LIMIT} AI edits a month, PDF and ZIP export, and Generate (a full document from a prompt). Cancel anytime.`),
      p('If something stopped you, a price, a missing feature, a card that would not go through, reply to this email and tell me. I read every one.'),
    ],
    cta: { label: 'Finish checkout', href: input.recoveryUrl },
    unsubscribeUrl: input.unsubscribeUrl,
  });
}

export function checkoutRecoveryOfferEmail(input: CheckoutRecoveryEmailInput): LifecycleEmailContent {
  const cart = cartLabel(input);
  const offer = input.promoCode
    ? [
        p(`Basil here. One last note about the ${cart} checkout you left open: use the code ${input.promoCode} and the first two months are half price.`),
        p('The link below reopens your checkout with the code ready to apply (or type it into the promotion code box). It is the same discount I offer people who are about to cancel, so this is as low as it goes.'),
      ]
    : [
        p(`Basil here. One last note about the ${cart} checkout you left open. The link below reopens it; nothing was charged.`),
        p('Free stays free: 5 AI edits a day, unlimited compiles. Pro is for when you reach for the AI a lot.'),
      ];
  return renderLifecycleEmail({
    template: 'checkout_recovery_offer',
    subject: input.promoCode ? 'Half price for two months of Octree Pro' : 'Still thinking about Octree Pro?',
    preheader: input.promoCode
      ? `Code ${input.promoCode}: 50% off your first two months.`
      : 'Your checkout link still works.',
    paragraphs: [...offer, p('After this I will leave you alone. Reply if anything is unclear.')],
    cta: { label: input.promoCode ? 'Finish checkout with 50% off' : 'Finish checkout', href: input.recoveryUrl },
    unsubscribeUrl: input.unsubscribeUrl,
  });
}
