import type { CitationEntry } from '@/types/citation';

function escapeBibtexValue(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/{/g, '\\{')
    .replace(/}/g, '\\}')
    .replace(/\n+/g, ' ')
    .trim();
}

function inferEntryType(itemType?: string): string {
  if (!itemType) return 'misc';
  if (itemType.includes('article')) return 'article';
  if (itemType.includes('book')) return 'book';
  if (itemType.includes('thesis')) return 'phdthesis';
  if (itemType.includes('conference')) return 'inproceedings';
  return 'misc';
}

function toBibEntry(entry: CitationEntry): string {
  const type = inferEntryType(entry.itemType);
  const fields = [
    `  title = {${escapeBibtexValue(entry.title)}},`,
    `  author = {${escapeBibtexValue(entry.author)}},`,
    `  year = {${escapeBibtexValue(entry.year || 'n.d.')}},`,
  ];

  if (entry.source) {
    fields.push(`  note = {${escapeBibtexValue(entry.source)}},`);
  }

  return `@${type}{${entry.key},\n${fields.join('\n')}\n}`;
}

export function generateBibtex(entries: CitationEntry[]): string {
  const sorted = [...entries].sort((a, b) => a.key.localeCompare(b.key));
  return sorted.map(toBibEntry).join('\n\n');
}

