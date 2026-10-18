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
  subject: string;
  /** One-line preview text shown by mail clients after the subject. */
  preheader?: string;
  /** Body paragraphs as `{ html, text }` pairs, in order. */
  paragraphs: Array<{ html: string; text: string }>;
  cta: { label: string; href: string };
  /** Lines after the CTA (e.g. the sign-off); plain strings, escaped. */
  closing?: string[];
  unsubscribeUrl: string;
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

const FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';

export function renderLifecycleEmail(input: LifecycleLayoutInput): LifecycleEmailContent {
  const closing = input.closing ?? ['— Basil, founder of Octree'];
  const preheader = input.preheader ? escapeHtml(input.preheader) : '';

  const bodyHtml = input.paragraphs
    .map(
      (para) =>
        `<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#27272a;">${para.html}</p>`
    )
    .join('\n');

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
<p style="margin:24px 0;">
<a href="${escapeHtml(input.cta.href)}" style="display:inline-block;background:#1e66ff;color:#ffffff;padding:12px 24px;border-radius:8px;font-size:14px;font-weight:600;text-decoration:none;">${escapeHtml(input.cta.label)}</a>
</p>
<div style="padding-top:16px;">
${closingHtml}
</div>
<p style="margin:48px 0 0;font-size:13px;line-height:1.5;color:#a1a1aa;">
You get this because you have an Octree account. <a href="${escapeHtml(input.unsubscribeUrl)}" style="color:#71717a;text-decoration:underline;">Unsubscribe</a> from these emails in one click.
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
    closing.join('\n'),
    `You get this because you have an Octree account. Unsubscribe: ${input.unsubscribeUrl}`,
  ].join('\n\n');

  return { subject: input.subject, html, text };
}
