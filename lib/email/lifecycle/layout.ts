/**
 * Shared frame for the lifecycle emails: plain text-first HTML, one button,
 * no images, a footer with the unsubscribe link. Each template hands in its
 * paragraphs (already-escaped HTML fragments via `p`/`link`) and the CTA.
 */

export interface LifecycleEmailContent {
  subject: string;
  html: string;
  text: string;
}

export interface LifecycleLayoutInput {
  /**
   * The template name, for `utm_campaign`: every link in the body and the
   * button is tagged `utm_source=lifecycle&utm_medium=email&utm_campaign=<template>`
   * so a visit from the email is attributed in PostHog. The unsubscribe link
   * is left alone.
   */
  template: string;
  subject: string;
  /** One-line preview text shown by mail clients after the subject. */
  preheader?: string;
  /** Body paragraphs as `{ html, text }` pairs, in order. */
  paragraphs: Array<{ html: string; text: string }>;
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
 * Re-tags the links inside a rendered paragraph. `link()` is the only thing
 * that puts a URL in a paragraph, so the two shapes it writes are the two
 * rewritten: `href="..."` (HTML-escaped) and `(url)` in the text version.
 */
function tagParagraphLinks(para: { html: string; text: string }, template: string): { html: string; text: string } {
  const unescape = (value: string) => value.replace(/&quot;/g, '"').replace(/&gt;/g, '>').replace(/&lt;/g, '<').replace(/&amp;/g, '&');
  return {
    html: para.html.replace(/href="([^"]*)"/g, (_m, href: string) => `href="${escapeHtml(withEmailUtm(unescape(href), template))}"`),
    text: para.text.replace(/\((https?:\/\/[^\s)]+)\)/g, (_m, href: string) => `(${withEmailUtm(href, template)})`),
  };
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Plain paragraph: same text in both versions. */
export function p(text: string): { html: string; text: string } {
  return { html: escapeHtml(text), text };
}

/** Inline link; the text version shows the URL in parentheses. */
export function link(label: string, href: string): { html: string; text: string } {
  return {
    html: `<a href="${escapeHtml(href)}" style="color:#1e66ff;text-decoration:underline;">${escapeHtml(label)}</a>`,
    text: `${label} (${href})`,
  };
}

/** Joins fragments into one paragraph. */
export function join(...parts: Array<string | { html: string; text: string }>): { html: string; text: string } {
  const html = parts.map((part) => (typeof part === 'string' ? escapeHtml(part) : part.html)).join('');
  const text = parts.map((part) => (typeof part === 'string' ? part : part.text)).join('');
  return { html, text };
}

// Single quotes inside: the value goes into a double-quoted style attribute.
const FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

export function renderLifecycleEmail(layout: LifecycleLayoutInput): LifecycleEmailContent {
  const input: LifecycleLayoutInput = {
    ...layout,
    paragraphs: layout.paragraphs.map((para) => tagParagraphLinks(para, layout.template)),
    cta: { ...layout.cta, href: withEmailUtm(layout.cta.href, layout.template) },
    secondary: layout.secondary
      ? { ...layout.secondary, href: withEmailUtm(layout.secondary.href, layout.template) }
      : undefined,
  };
  const closing = input.closing ?? ['— Basil, founder of Octree'];
  const preheader = input.preheader ? escapeHtml(input.preheader) : '';

  const bodyHtml = input.paragraphs
    .map(
      (para) =>
        `<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#27272a;">${para.html}</p>`
    )
    .join('\n');

  const secondaryHtml = input.secondary
    ? `<p style="margin:0 0 24px;font-size:13px;line-height:1.5;color:#52525b;"><a href="${escapeHtml(input.secondary.href)}" style="color:#52525b;text-decoration:underline;">${escapeHtml(input.secondary.label)}</a></p>`
    : '';

  const footerHtml = input.unsubscribeUrl
    ? `You get this because you have an Octree account. <a href="${escapeHtml(input.unsubscribeUrl)}" style="color:#71717a;text-decoration:underline;">Unsubscribe</a> from these emails in one click.`
    : 'You get this because you have an Octree account and this concerns your billing.';
  const footerText = input.unsubscribeUrl
    ? `You get this because you have an Octree account. Unsubscribe: ${input.unsubscribeUrl}`
    : 'You get this because you have an Octree account and this concerns your billing.';

  const closingHtml = closing
    .map((line) => `<p style="margin:0;font-size:15px;line-height:1.6;color:#52525b;">${escapeHtml(line)}</p>`)
    .join('\n');

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(input.subject)}</title>
</head>
<body style="margin:0;padding:0;background:#ffffff;">
${preheader ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:#ffffff;">${preheader}</div>` : ''}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#ffffff;">
<tr><td align="center" style="padding:40px 16px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;font-family:${FONT};">
<tr><td>
${bodyHtml}
<p style="margin:24px 0 ${input.secondary ? '8px' : '24px'};">
<a href="${escapeHtml(input.cta.href)}" style="display:inline-block;background:#1e66ff;color:#ffffff;padding:12px 24px;border-radius:8px;font-size:14px;font-weight:600;text-decoration:none;">${escapeHtml(input.cta.label)}</a>
</p>
${secondaryHtml}
<div style="padding-top:16px;">
${closingHtml}
</div>
<p style="margin:48px 0 0;font-size:13px;line-height:1.5;color:#a1a1aa;">
${footerHtml}
</p>
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;

  const text = [
    ...input.paragraphs.map((para) => para.text),
    `${input.cta.label}: ${input.cta.href}`,
    ...(input.secondary ? [`${input.secondary.label}: ${input.secondary.href}`] : []),
    closing.join('\n'),
    footerText,
  ].join('\n\n');

  return { subject: input.subject, html, text };
}
