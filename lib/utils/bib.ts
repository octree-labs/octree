import type { ProjectFile } from '@/hooks/use-file-editor';

/**
 * Finds the 1-based line number of the BibTeX entry with the given key in the content.
 * Matches @type{key, or @type{key} at the start of an entry.
 */
export function findBibEntryLine(bibContent: string, key: string): number | null {
  const lines = bibContent.split(/\r?\n/);
  const keyEscaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const entryStartRe = new RegExp(
    `@\\s*[a-zA-Z]+\\s*\\{\\s*${keyEscaped}\\s*[,}]`
  );
  for (let i = 0; i < lines.length; i++) {
    if (entryStartRe.test(lines[i])) {
      return i + 1;
    }
  }
  return null;
}

/**
 * Returns the .bib file path and 1-based line number for the given citation key,
 * or null if not found. Searches all .bib files in projectFiles.
 */
export function findBibLocation(
  key: string,
  projectFiles: ProjectFile[] | null
): { filePath: string; lineNumber: number } | null {
  if (!projectFiles) return null;
  const bibFiles = projectFiles.filter((pf) =>
    pf.file.name.toLowerCase().endsWith('.bib')
  );
  for (const pf of bibFiles) {
    const content = pf.document?.content;
    if (typeof content !== 'string') continue;
    const line = findBibEntryLine(content, key);
    if (line !== null) {
      return { filePath: pf.file.name, lineNumber: line };
    }
  }
  return null;
}
