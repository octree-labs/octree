import type { CoverageReport } from '@/types/resume';

// Rough fidelity check between the source resume text and the redesigned PDF
// text: which words/numbers went missing, and which appeared from nowhere.

const STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'from', 'that', 'this', 'into', 'over', 'using',
  'was', 'were', 'are', 'has', 'have', 'our', 'their', 'its', 'via', 'per',
]);

function tokens(text: string): Set<string> {
  const normalized = text
    .normalize('NFKD')
    .replace(/[\u0300-\u036f\u200b-\u200d\u2060\ufeff]/g, '')
    .toLowerCase()
    .replace(/[\u2013\u2014]/g, '-');
  const words = normalized.match(/[a-z0-9][a-z0-9+#.]*[a-z0-9+#]|[0-9]/g) ?? [];
  return new Set(
    words.filter((w) => (w.length >= 3 || /\d/.test(w)) && !STOPWORDS.has(w))
  );
}

export function compareText(source: string, output: string): CoverageReport {
  const src = tokens(source);
  const out = tokens(output);
  const missing = [...src].filter((t) => !out.has(t));
  const added = [...out].filter((t) => !src.has(t));
  const coverage = src.size ? (src.size - missing.length) / src.size : 1;
  return { coverage, missing, added };
}
