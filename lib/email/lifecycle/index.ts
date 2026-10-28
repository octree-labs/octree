import { PRO_MONTHLY_EDIT_LIMIT, PRO_PLANS } from '@/data/constants';
import { WARM_LEAD_OFFER, warmLeadOfferUrl } from '@/lib/checkout-offers';
import {
  cards,
  checklist,
  facts,
  join,
  link,
  offer,
  p,
  renderLifecycleEmail,
  steps,
  type LifecycleEmailContent,
} from './layout';

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
    eyebrow: 'Get started',
    headline: 'Start with a template',
    subheadline: 'Pick one, open it in Octree, and you have a compiling document in under a minute.',
    blocks: [
      p("Hi, Basil here. I build Octree. You signed up but haven't started a project yet, so here is the fastest way in: pick a template and open it in the editor."),
      cards([
        {
          title: "Jake's Resume",
          description: 'The one-page engineering resume most people use.',
          href: `${templates}/jakes-resume`,
          linkLabel: 'View template',
        },
        {
          title: 'NeurIPS 2027',
          description: 'The conference paper style file, ready to compile.',
          href: `${templates}/neurips-2027`,
          linkLabel: 'View template',
        },
        {
          title: 'Thesis',
          description: 'Chapters, bibliography and front matter already wired up.',
          href: `${templates}/thesis`,
          linkLabel: 'View template',
        },
      ]),
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
    eyebrow: 'Free plan',
    headline: "You've used your free AI edits",
    subheadline: 'Free stays free. Pro is there for when you need more.',
    blocks: [
      p('Basil here. You hit the free limit on AI edits in Octree, which means you actually used it. Thanks.'),
      p(`Free stays free: 5 AI edits a day, unlimited compiles. If you want more, Pro is ${PRO_PLANS.monthly.price}/month:`),
      checklist([
        { title: `${PRO_MONTHLY_EDIT_LIMIT} AI edits a month`, body: p('Rewrite, restructure or fix errors with no daily cap.') },
        { title: 'PDF and ZIP export', body: p('Download the finished PDF or the full source.') },
        { title: 'Generate', body: p('A full document from a prompt.') },
      ]),
      p('Cancel anytime. Upgrading takes about a minute and the button below opens the checkout inside the editor.'),
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
    eyebrow: 'Octree tip',
    headline: 'Jump from PDF to source',
    subheadline: 'Double-click to land on the exact line. It works on every plan.',
    blocks: [
      p("Basil here. You've had Octree for a week, so one tip that most people miss:"),
      steps([
        { title: 'PDF to source', body: p('Double-click anywhere in the compiled PDF and the editor jumps to that line of source.') },
        { title: 'Source to PDF', body: p('Double-click a line in the editor and the PDF scrolls to it.') },
      ]),
      p('This is SyncTeX, and it is on for every project, including free ones.'),
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
    eyebrow: "What's new",
    headline: "What's changed since you left",
    subheadline: 'One short note, and then I will leave you alone.',
    blocks: [
      p('Basil here. You had Octree Pro for a while and cancelled, which is fair. A few things are different now:'),
      checklist([
        {
          title: 'The editor is free',
          body: p('Every account gets the editor, compiles and 5 AI edits a day for free, so your projects are still there and still work.'),
        },
        {
          title: 'Faster compiles',
          body: p('A dedicated compile service replaced the old serverless one, and PDF-to-source jumping (SyncTeX) is on everywhere.'),
        },
        {
          title: 'New templates and converters',
          body: join(
            'Resume, thesis and conference templates that open in Octree, plus converters for Markdown, HTML, MathML and Mermaid, on ',
            link('tools.useoctree.com', input.toolsUrl),
            '.'
          ),
        },
      ]),
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
    eyebrow: 'Your Pro plan',
    headline: 'Three things to try in two minutes',
    subheadline: 'Documents come in waves. These are here for the next one.',
    blocks: [
      p("Basil here. You're on Octree Pro and haven't opened it in about a week. That's fine; documents come in waves. If you have a spare two minutes, any of these pays for itself:"),
      steps([
        {
          title: 'Import an existing project',
          body: p('Upload a .tex file or a ZIP (an Overleaf export works as-is) from New Project on the dashboard. It compiles right away.'),
        },
        {
          title: 'Fix a compile error with the AI',
          body: p('Open a project whose build fails and press "Fix with AI" on the error. It edits the line; you accept or reject.'),
        },
        {
          title: 'Export a finished PDF',
          body: p('The Export button in the editor gives you the PDF, or the full source as a ZIP.'),
        },
      ]),
      p("If none of that is useful right now, nothing to do. Reply if there's something you expected Octree to do and it doesn't; that is the most useful email I get."),
    ],
    cta: { label: 'Open Octree', href: `${input.appUrl}/` },
    unsubscribeUrl: input.unsubscribeUrl,
  });
}

/** Which paywall the warm lead ran into; picks the subject and the first line. */
export type WarmLeadVariant = 'daily_limit' | 'export' | 'generate' | 'ats';

/**
 * Maps a paywall hit (paywall_hits.reason / feature) to the copy variant.
 * Anything unknown reads as the export / Pro feature paywall.
 */
export function warmLeadVariant(reason: string | null | undefined, feature?: string | null): WarmLeadVariant {
  if (reason === 'daily_limit') return 'daily_limit';
  if (reason === 'generate_quota' || feature === 'generate') return 'generate';
  if (feature === 'ats') return 'ats';
  return 'export';
}

const WARM_LEAD_COPY: Record<WarmLeadVariant, { subject: string; headline: string; ranInto: string }> = {
  daily_limit: {
    subject: "You hit the daily AI edit limit — here's 50% off your first month",
    headline: 'Keep editing past the daily limit',
    ranInto: 'the daily AI edit limit',
  },
  export: {
    subject: 'Your PDF is one step away — 50% off your first month',
    headline: 'Your PDF is one step away',
    ranInto: 'the paywall when exporting your PDF',
  },
  generate: {
    subject: 'Finish that document — 50% off your first month',
    headline: 'Finish that document',
    ranInto: 'the end of the free generation',
  },
  ats: {
    subject: 'Get your resume past the ATS — 50% off your first month',
    ranInto: 'the paywall on the ATS analysis of your resume',
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
  const deal = WARM_LEAD_OFFER;
  return renderLifecycleEmail({
    template: 'warm_lead_offer',
    subject: copy.subject,
    preheader: `${deal.label} of Octree Pro. Code ${deal.promotionCode}.`,
    eyebrow: `${deal.percentOff}% off Octree Pro`,
    headline: copy.headline,
    subheadline: `${deal.label} of Pro, on the monthly plan.`,
    blocks: [
      p(`Hi, I'm Basil, I build Octree. I saw you ran into ${copy.ranInto} ${input.when ?? 'recently'}. That's a frustrating place to stop.`),
      p(`If you want to keep going, here's ${deal.percentOff}% off your first month of Pro on the monthly plan (${PRO_MONTHLY_EDIT_LIMIT} AI edits a month, PDF export, no daily cap):`),
      offer(
        `${deal.percentOff}% off your first month`,
        `Applied automatically. Use code ${deal.promotionCode} at checkout if the discount doesn't show.`,
        deal.promotionCode
      ),
      p('If something else was in the way, just reply and tell me — one line is enough.'),
    ],
    cta: { label: `Claim ${deal.percentOff}% off`, href: warmLeadOfferUrl(input.appUrl) },
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
        ? 'If you meant to let Pro lapse, cancel from Settings so we stop retrying the card; otherwise the subscription ends on its own once the retries fail. Your projects stay.'
        : 'If you no longer need Octree, cancel from Settings so we stop retrying the card; if you do nothing and the payment keeps failing, the subscription ends and the account drops to the free plan. Your projects stay either way.'
    ),
  ];
  const summary = facts([
    ['Plan', 'Octree Pro'],
    ['Amount due', amount],
    ['Next automatic retry', retry ?? 'None scheduled'],
  ]);
  return { amount, blocks: [paragraphs[0], summary, ...paragraphs.slice(1)] };
}

export function paymentFailedEmail(input: PaymentFailedEmailInput): LifecycleEmailContent {
  const { amount, blocks } = paymentFailedBody(input, false);
  return renderLifecycleEmail({
    template: 'payment_failed',
    subject: "Your Octree Pro payment didn't go through",
    preheader: `The ${amount} payment failed. Update your card to keep Pro.`,
    eyebrow: 'Billing',
    headline: "Your payment didn't go through",
    subheadline: 'Usually an expired card or a bank decline. It takes a minute to fix.',
    blocks,
    cta: { label: 'Pay or update card', href: input.hostedInvoiceUrl ?? input.billingUrl },
    secondary: { label: 'Manage billing in Octree', href: input.billingUrl },
  });
}

export function paymentFailedReminderEmail(input: PaymentFailedEmailInput): LifecycleEmailContent {
  const { amount, blocks } = paymentFailedBody(input, true);
  return renderLifecycleEmail({
    template: 'payment_failed_reminder',
    subject: 'Reminder: Octree Pro payment still failing',
    preheader: `The ${amount} payment is still open. Update your card to keep Pro.`,
    eyebrow: 'Billing',
    headline: 'Your payment is still failing',
    subheadline: 'Pay the open invoice or update your card to keep Pro.',
    blocks,
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
    case 'export_single':
      return `export for one document (${amount ?? '$4.99'})`;
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
    eyebrow: 'Checkout',
    headline: 'Your checkout is still open',
    subheadline: 'Nothing was charged. The button below picks up where you left off.',
    blocks: [
      p(`Basil here. You started checking out for ${cart} and did not finish. No problem; the link below reopens the same checkout, nothing was charged.`),
      facts([['In your cart', cart]]),
      p(`Pro is ${PRO_MONTHLY_EDIT_LIMIT} AI edits a month, PDF and ZIP export, and Generate (a full document from a prompt). Cancel anytime.`),
      p('If something stopped you, a price, a missing feature, a card that would not go through, reply to this email and tell me. I read every one.'),
    ],
    cta: { label: 'Finish checkout', href: input.recoveryUrl },
    unsubscribeUrl: input.unsubscribeUrl,
  });
}

export function checkoutRecoveryOfferEmail(input: CheckoutRecoveryEmailInput): LifecycleEmailContent {
  const cart = cartLabel(input);
  const body = input.promoCode
    ? [
        p(`Basil here. One last note about the ${cart} checkout you left open: use the code ${input.promoCode} and the first two months are half price.`),
        offer('50% off your first two months', 'Octree Pro, applied to your open checkout', input.promoCode),
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
    eyebrow: input.promoCode ? '50% off Octree Pro' : 'Checkout',
    headline: input.promoCode ? 'Half price for two months of Pro' : 'Still thinking about Octree Pro?',
    subheadline: input.promoCode ? 'The lowest price Octree Pro goes.' : 'Your checkout link still works.',
    blocks: [...body, p('After this I will leave you alone. Reply if anything is unclear.')],
    cta: { label: input.promoCode ? 'Finish checkout with 50% off' : 'Finish checkout', href: input.recoveryUrl },
    unsubscribeUrl: input.unsubscribeUrl,
  });
}
