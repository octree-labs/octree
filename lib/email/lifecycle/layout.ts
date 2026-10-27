import { getAppUrl } from '../unsubscribe';

/**
 * Shared frame for every email Octree sends: the logo, then a white card
 * with the headline, the body blocks and one button, and a footer with the
 * unsubscribe link. Each template hands in its blocks
 * (already-escaped HTML fragments via `p`/`link`, or the structured blocks
 * below) and the CTA.
 */

export interface LifecycleEmailContent {
  subject: string;
  html: string;
  text: string;
}

/** An HTML fragment and its plain-text twin; what `p`, `link` and `join` return. */
export interface EmailFragment {
  html: string;
  text: string;
}

/** Linked tiles, one per row (e.g. the templates in the welcome email). */
export interface CardsBlock {
  kind: 'cards';
  cards: Array<{ title: string; description: string; href: string; linkLabel: string }>;
}

/** A checklist or numbered steps; each item is an optional bold title and a body. */
export interface ListBlock {
  kind: 'list';
  style: 'check' | 'number';
  items: Array<{ title?: string; body: EmailFragment }>;
}

/** The coupon box: headline, one line of detail, the code. */
export interface OfferBlock {
  kind: 'offer';
  headline: string;
  detail: string;
  code: string;
}

/** Label / value rows, e.g. the amount and retry date of a failed payment. */
export interface FactsBlock {
  kind: 'facts';
  rows: Array<[label: string, value: string]>;
}

export type EmailBlock = EmailFragment | CardsBlock | ListBlock | OfferBlock | FactsBlock;

export interface LifecycleLayoutInput {
  /**
   * The template name, for `utm_campaign`: every link in the body, the
   * button and the logo is tagged
   * `utm_source=lifecycle&utm_medium=email&utm_campaign=<template>` so a
   * visit from the email is attributed in PostHog. The unsubscribe link is
   * left alone.
   */
  template: string;
  subject: string;
  /** One-line preview text shown by mail clients after the subject. */
  preheader?: string;
  /** Small uppercase label above the headline, e.g. "Billing". */
  eyebrow?: string;
  /** The banner headline. */
  headline: string;
  /** One line under the headline. */
  subheadline?: string;
  /** Body blocks, in order. */
  blocks: EmailBlock[];
  cta: { label: string; href: string };
  /** Lines after the CTA (e.g. the sign-off); plain strings, escaped. */
  closing?: string[];
  /**
   * The one-click unsubscribe link in the footer. Omitted for transactional
   * mail (a failed-payment notice): the footer then says why the email was
   * sent and offers no opt-out, which is the CAN-SPAM / GDPR treatment of
   * account notices.
   */
  unsubscribeUrl?: string;
  /** Overrides the footer's reason line (the default says the person has an Octree account). */
  footerReason?: string;
  /** Optional secondary link under the button, e.g. the billing portal. */
  secondary?: { label: string; href: string };
}

export const EMAIL_UTM_SOURCE = 'lifecycle';
export const EMAIL_UTM_MEDIUM = 'email';

/**
 * `href` with the campaign UTM parameters appended. Existing query strings
 * and fragments are kept; a parameter already present is not overwritten
 * (a template that deep-links with its own utm_* keeps it). Stripe-hosted
 * pages (checkout recovery, hosted invoices) are returned as issued: they
 * carry no PostHog, so a tag there measures nothing, and the URLs are
 * signed and best left untouched. Anything that is not an absolute URL is
 * returned unchanged.
 */
export function withEmailUtm(href: string, template: string): string {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return href;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return href;
  if (url.hostname === 'stripe.com' || url.hostname.endsWith('.stripe.com')) return href;
  const params: Array<[string, string]> = [
    ['utm_source', EMAIL_UTM_SOURCE],
    ['utm_medium', EMAIL_UTM_MEDIUM],
    ['utm_campaign', template],
  ];
  for (const [key, value] of params) {
    if (!url.searchParams.has(key)) url.searchParams.set(key, value);
  }
  return url.toString();
}

/**
 * Re-tags the links inside a rendered fragment. `link()` is the only thing
 * that puts a URL in a fragment, so the two shapes it writes are the two
 * rewritten: `href="..."` (HTML-escaped) and `(url)` in the text version.
 */
function tagFragmentLinks(fragment: EmailFragment, template: string): EmailFragment {
  const unescape = (value: string) => value.replace(/&quot;/g, '"').replace(/&gt;/g, '>').replace(/&lt;/g, '<').replace(/&amp;/g, '&');
  return {
    html: fragment.html.replace(/href="([^"]*)"/g, (_m, href: string) => `href="${escapeHtml(withEmailUtm(unescape(href), template))}"`),
    text: fragment.text.replace(/\((https?:\/\/[^\s)]+)\)/g, (_m, href: string) => `(${withEmailUtm(href, template)})`),
  };
}

function tagBlockLinks(block: EmailBlock, template: string): EmailBlock {
  if (!('kind' in block)) return tagFragmentLinks(block, template);
  switch (block.kind) {
    case 'cards':
      return { ...block, cards: block.cards.map((card) => ({ ...card, href: withEmailUtm(card.href, template) })) };
    case 'list':
      return { ...block, items: block.items.map((item) => ({ ...item, body: tagFragmentLinks(item.body, template) })) };
    default:
      return block;
  }
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Plain paragraph: same text in both versions. */
export function p(text: string): EmailFragment {
  return { html: escapeHtml(text), text };
}

/** Inline link; the text version shows the URL in parentheses. */
export function link(label: string, href: string): EmailFragment {
  return {
    html: `<a href="${escapeHtml(href)}" style="color:${BRAND};font-weight:600;text-decoration:underline;">${escapeHtml(label)}</a>`,
    text: `${label} (${href})`,
  };
}

/** Joins fragments into one paragraph. */
export function join(...parts: Array<string | EmailFragment>): EmailFragment {
  const html = parts.map((part) => (typeof part === 'string' ? escapeHtml(part) : part.html)).join('');
  const text = parts.map((part) => (typeof part === 'string' ? part : part.text)).join('');
  return { html, text };
}

export function cards(items: CardsBlock['cards']): CardsBlock {
  return { kind: 'cards', cards: items };
}

export function checklist(items: ListBlock['items']): ListBlock {
  return { kind: 'list', style: 'check', items };
}

export function steps(items: ListBlock['items']): ListBlock {
  return { kind: 'list', style: 'number', items };
}

export function offer(headline: string, detail: string, code: string): OfferBlock {
  return { kind: 'offer', headline, detail, code };
}

export function facts(rows: FactsBlock['rows']): FactsBlock {
  return { kind: 'facts', rows };
}

// Single quotes inside: the value goes into a double-quoted style attribute.
const FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
const MONO = "'SF Mono', SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace";
const BRAND = '#0F62FE';
const INK = '#0a0a0a';
const BODY = '#3f3f46';
const MUTED = '#71717a';
const BORDER = '#e4e4e7';
const SURFACE = '#fafafa';
const PAGE = '#f4f4f5';

/** The logo is served from the app's public folder (public/email/octree-logo.png); PNG, since Gmail drops SVG. */
function logoUrl(): string {
  return `${getAppUrl()}/email/octree-logo.png`;
}

function renderBlockHtml(block: EmailBlock): string {
  if (!('kind' in block)) {
    return `<p style="margin:0 0 16px;font-size:15px;line-height:1.65;color:${BODY};">${block.html}</p>`;
  }
  switch (block.kind) {
    case 'cards':
      return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:4px 0 12px;">
${block.cards
  .map(
    (card) => `<tr><td style="padding:0 0 10px;">
<a href="${escapeHtml(card.href)}" style="display:block;text-decoration:none;border:1px solid ${BORDER};border-radius:12px;background:${SURFACE};padding:16px 18px;">
<span style="display:block;font-size:15px;font-weight:600;color:${INK};">${escapeHtml(card.title)}</span>
<span style="display:block;margin-top:4px;font-size:14px;line-height:1.5;color:${MUTED};">${escapeHtml(card.description)}</span>
<span style="display:block;margin-top:10px;font-size:13px;font-weight:600;color:${BRAND};">${escapeHtml(card.linkLabel)} &rarr;</span>
</a>
</td></tr>`
  )
  .join('\n')}
</table>`;
    case 'list':
      return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:4px 0 12px;">
${block.items
  .map((item, index) => {
    const marker = block.style === 'number' ? String(index + 1) : '&#10003;';
    const title = item.title
      ? `<span style="display:block;font-size:15px;font-weight:600;color:${INK};margin-bottom:2px;">${escapeHtml(item.title)}</span>`
      : '';
    return `<tr>
<td width="34" valign="top" style="padding:0 0 16px;"><div style="width:24px;height:24px;line-height:24px;border-radius:999px;background:#E8F0FF;color:${BRAND};font-size:12px;font-weight:700;text-align:center;">${marker}</div></td>
<td valign="top" style="padding:2px 0 16px;font-size:15px;line-height:1.6;color:${BODY};">${title}${item.body.html}</td>
</tr>`;
  })
  .join('\n')}
</table>`;
    case 'offer':
      return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:8px 0 20px;">
<tr><td align="center" style="border:2px dashed #9DBDFF;border-radius:12px;background:#F3F7FF;padding:22px 20px;">
<p style="margin:0;font-size:22px;line-height:1.3;font-weight:700;color:${BRAND};letter-spacing:-0.3px;">${escapeHtml(block.headline)}</p>
<p style="margin:6px 0 0;font-size:13px;line-height:1.5;color:${MUTED};">${escapeHtml(block.detail)}</p>
<p style="margin:14px 0 0;"><span style="display:inline-block;font-family:${MONO};font-size:16px;font-weight:700;letter-spacing:2px;color:${INK};background:#ffffff;border:1px solid #d4d4d8;border-radius:6px;padding:7px 16px;">${escapeHtml(block.code)}</span></p>
</td></tr>
</table>`;
    case 'facts':
      return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:4px 0 20px;border:1px solid ${BORDER};border-radius:12px;background:${SURFACE};border-collapse:separate;">
${block.rows
  .map(
    ([label, value], index) => `<tr>
<td style="padding:12px 16px;font-size:13px;color:${MUTED};${index > 0 ? `border-top:1px solid ${BORDER};` : ''}">${escapeHtml(label)}</td>
<td align="right" style="padding:12px 16px;font-size:14px;font-weight:600;color:${INK};${index > 0 ? `border-top:1px solid ${BORDER};` : ''}">${escapeHtml(value)}</td>
</tr>`
  )
  .join('\n')}
</table>`;
  }
}

function renderBlockText(block: EmailBlock): string {
  if (!('kind' in block)) return block.text;
  switch (block.kind) {
    case 'cards':
      return block.cards.map((card) => `${card.title} - ${card.description}\n${card.href}`).join('\n\n');
    case 'list':
      return block.items
        .map((item, index) => {
          const marker = block.style === 'number' ? `${index + 1}.` : '-';
          return `${marker} ${item.title ? `${item.title}: ` : ''}${item.body.text}`;
        })
        .join('\n');
    case 'offer':
      return `${block.headline}. ${block.detail}\nCode: ${block.code}`;
    case 'facts':
      return block.rows.map(([label, value]) => `${label}: ${value}`).join('\n');
  }
}

export function renderLifecycleEmail(layout: LifecycleLayoutInput): LifecycleEmailContent {
  const input: LifecycleLayoutInput = {
    ...layout,
    blocks: layout.blocks.map((block) => tagBlockLinks(block, layout.template)),
    cta: { ...layout.cta, href: withEmailUtm(layout.cta.href, layout.template) },
    secondary: layout.secondary
      ? { ...layout.secondary, href: withEmailUtm(layout.secondary.href, layout.template) }
      : undefined,
  };
  const homeHref = withEmailUtm(`${getAppUrl()}/`, layout.template);
  const closing = input.closing ?? ['Basil', 'Founder, Octree'];
  // Zero-width padding keeps clients from pulling body text into the preview after the preheader.
  const preheader = input.preheader ? `${escapeHtml(input.preheader)}${'&#847;&zwnj;&nbsp;'.repeat(40)}` : '';

  const bodyHtml = input.blocks.map(renderBlockHtml).join('\n');

  const secondaryHtml = input.secondary
    ? `<p style="margin:0 0 8px;font-size:13px;line-height:1.5;color:${MUTED};"><a href="${escapeHtml(input.secondary.href)}" style="color:${MUTED};text-decoration:underline;">${escapeHtml(input.secondary.label)}</a></p>`
    : '';

  const reason = input.footerReason
    ?? (input.unsubscribeUrl
      ? 'You get this because you have an Octree account.'
      : 'You get this because you have an Octree account and this concerns your billing.');
  const footerHtml = input.unsubscribeUrl
    ? `${escapeHtml(reason)} <a href="${escapeHtml(input.unsubscribeUrl)}" style="color:${MUTED};text-decoration:underline;">Unsubscribe</a> in one click.`
    : escapeHtml(reason);
  const footerText = input.unsubscribeUrl ? `${reason} Unsubscribe: ${input.unsubscribeUrl}` : reason;

  const closingHtml = closing
    .map(
      (line, index) =>
        `<p style="margin:0;font-size:${index === 0 ? '15px' : '14px'};line-height:1.6;color:${index === 0 ? INK : MUTED};${index === 0 ? 'font-weight:600;' : ''}">${escapeHtml(line)}</p>`
    )
    .join('\n');

  const eyebrowHtml = input.eyebrow
    ? `<p style="margin:0 0 10px;font-size:12px;line-height:1;font-weight:700;letter-spacing:1.2px;text-transform:uppercase;color:${BRAND};">${escapeHtml(input.eyebrow)}</p>`
    : '';
  const subheadlineHtml = input.subheadline
    ? `<p style="margin:8px 0 0;font-size:15px;line-height:1.55;color:${MUTED};">${escapeHtml(input.subheadline)}</p>`
    : '';

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${escapeHtml(input.subject)}</title>
</head>
<body style="margin:0;padding:0;background:${PAGE};">
${preheader ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:${PAGE};">${preheader}</div>` : ''}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${PAGE};">
<tr><td align="center" style="padding:32px 12px 40px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;font-family:${FONT};">
<tr><td style="padding:0 4px 18px;">
<a href="${escapeHtml(homeHref)}" style="text-decoration:none;color:${INK};"><img src="${escapeHtml(logoUrl())}" width="28" height="28" alt="Octree" style="display:inline-block;vertical-align:middle;border:0;outline:none;"><span style="display:inline-block;vertical-align:middle;margin-left:8px;font-size:19px;font-weight:700;letter-spacing:-0.4px;color:${INK};">octree</span></a>
</td></tr>
<tr><td style="background:#ffffff;border:1px solid ${BORDER};border-radius:16px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">
<tr><td style="padding:32px 32px 24px;border-bottom:1px solid ${BORDER};">
${eyebrowHtml}
<h1 style="margin:0;font-size:24px;line-height:1.3;font-weight:700;letter-spacing:-0.4px;color:${INK};">${escapeHtml(input.headline)}</h1>
${subheadlineHtml}
</td></tr>
<tr><td style="padding:28px 32px 28px;">
${bodyHtml}
<p style="margin:12px 0 ${input.secondary ? '14px' : '28px'};">
<a href="${escapeHtml(input.cta.href)}" style="display:inline-block;background:${BRAND};color:#ffffff;padding:13px 26px;border-radius:8px;font-size:15px;font-weight:600;text-decoration:none;">${escapeHtml(input.cta.label)}</a>
</p>
${secondaryHtml}
<div style="border-top:1px solid ${BORDER};padding-top:20px;margin-top:${input.secondary ? '20px' : '0'};">
${closingHtml}
</div>
</td></tr>
</table>
</td></tr>
<tr><td align="center" style="padding:24px 16px 0;font-size:12px;line-height:1.6;color:#a1a1aa;">
<p style="margin:0;">${footerHtml}</p>
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;

  const text = [
    input.headline,
    ...input.blocks.map(renderBlockText),
    `${input.cta.label}: ${input.cta.href}`,
    ...(input.secondary ? [`${input.secondary.label}: ${input.secondary.href}`] : []),
    closing.join('\n'),
    footerText,
  ].join('\n\n');

  return { subject: input.subject, html, text };
}
