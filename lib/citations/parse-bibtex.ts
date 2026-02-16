import type { CitationEntry } from '@/types/citation';

const ENTRY_REGEX = /@([a-zA-Z]+)\s*{\s*([^,]+)\s*,([\s\S]*?)\n}\s*/g;
const FIELD_REGEX = /([a-zA-Z]+)\s*=\s*[{"]([\s\S]*?)[}"]\s*,?/g;

function clean(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

export function parseBibtexEntries(bibtex: string): CitationEntry[] {
  const entries: CitationEntry[] = [];
  if (!bibtex.trim()) return entries;

  let entryMatch: RegExpExecArray | null;
  while ((entryMatch = ENTRY_REGEX.exec(bibtex))) {
    const itemType = entryMatch[1];
    const key = clean(entryMatch[2]);
    const body = entryMatch[3];

    let title = 'Untitled';
    let author = 'Unknown';
    let year = 'n.d.';
    let source: string | undefined;

    let fieldMatch: RegExpExecArray | null;
    while ((fieldMatch = FIELD_REGEX.exec(body))) {
      const fieldName = fieldMatch[1].toLowerCase();
      const fieldValue = clean(fieldMatch[2]);

      if (fieldName === 'title') title = fieldValue;
      if (fieldName === 'author') author = fieldValue;
      if (fieldName === 'year') year = fieldValue;
      if (fieldName === 'journal' || fieldName === 'booktitle' || fieldName === 'note') {
        source = fieldValue;
      }
    }

    FIELD_REGEX.lastIndex = 0;
    entries.push({ key, title, author, year, source, itemType });
  }

  return entries;
}

