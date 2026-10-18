import { PRO_MONTHLY_EDIT_LIMIT, PRO_PLANS } from '@/data/constants';
import { join, link, p, renderLifecycleEmail, type LifecycleEmailContent } from './layout';

export type { LifecycleEmailContent } from './layout';

export const LIFECYCLE_TEMPLATES = ['welcome', 'limit_hit', 'day7', 'winback'] as const;
export type LifecycleTemplate = (typeof LIFECYCLE_TEMPLATES)[number];

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

export const LIFECYCLE_EMAILS: Record<LifecycleTemplate, (input: LifecycleTemplateInput) => LifecycleEmailContent> = {
  welcome: welcomeEmail,
  limit_hit: limitHitEmail,
  day7: day7Email,
  winback: winbackEmail,
};

export function renderLifecycleTemplate(template: LifecycleTemplate, input: LifecycleTemplateInput): LifecycleEmailContent {
  return LIFECYCLE_EMAILS[template](input);
}
