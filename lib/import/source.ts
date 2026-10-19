/**
 * Labels for the `source` slug a draft was posted with
 * (`tools:tikz-generator`, `tools:templates:<slug>`, `www:learn:<slug>`).
 */

/** `tools:tikz-generator` -> `Tikz Generator`-ish label for the badge. */
export function sourceLabel(source: string | null): string | null {
  if (!source) return null;
  const slug = source.replace(/^(?:tools|www):/, '').replace(/[-_]+/g, ' ').trim();
  if (!slug) return null;
  return slug.replace(/\b\w/g, (c) => c.toUpperCase());
}

/** The site the draft was posted from, from the slug's prefix. */
export function sourceSite(source: string | null): string | null {
  if (!source) return null;
  if (source.startsWith('tools')) return 'tools.useoctree.com';
  if (source.startsWith('www')) return 'www.useoctree.com';
  return null;
}
