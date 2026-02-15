import { languages } from 'monaco-editor';
import type * as Monaco from 'monaco-editor';

/** Citation command pattern: matches \cite, \citep, \nocite, \citeauthor, \citeyear (with optional trailing space). */
const CITE_COMMAND_REGEX = /\\(cite[a-zA-Z]*|nocite|citeauthor|citeyear)\s*$/;

/**
 * If the position is inside \cite{key} (or \citep{key}, etc.), returns the citation key at that position; otherwise null.
 */
export function getCitationKeyAtPosition(
  model: Monaco.editor.ITextModel,
  position: Monaco.Position
): string | null {
  const lineNumber = position.lineNumber;
  const line = model.getLineContent(lineNumber);
  const column = position.column;
  const offset = column - 1;

  if (offset < 0 || offset >= line.length) return null;

  const word = model.getWordAtPosition(position);
  if (!word?.word) return null;

  const openBrace = line.lastIndexOf('{', offset);
  if (openBrace === -1) return null;

  for (let i = offset - 1; i >= 0; i--) {
    if (line[i] === '}') return null;
    if (line[i] === '{') {
      const beforeBrace = line.slice(0, i).trimEnd();
      if (CITE_COMMAND_REGEX.test(beforeBrace)) {
        return word.word;
      }
      return null;
    }
  }
  return null;
}

// Basic language configuration
export const latexLanguageConfiguration: languages.LanguageConfiguration = {
  brackets: [
    ['{', '}'],
    ['[', ']'],
    ['(', ')'],
  ],
  autoClosingPairs: [
    { open: '{', close: '}' },
    { open: '[', close: ']' },
    { open: '(', close: ')' },
  ],
};

// Token provider for syntax highlighting
// Citation commands (\cite, \citep, etc.) use 'citation'; the key inside {...} uses 'citation.key' so it's highlighted and clickable
export const latexTokenProvider: languages.IMonarchLanguage = {
  defaultToken: '',
  tokenizer: {
    root: [
      [/\\(cite[a-zA-Z]*|nocite|citeauthor|citeyear)\b/, 'citation', '@citeCommand'],
      [/\\[a-zA-Z]+/, 'keyword'],
      [/\$\$/, 'delimiter.math'],
      [/\$/, 'delimiter.math'],
      [/%.*$/, 'comment'],
      [/[{}()\[\]]/, 'delimiter'],
    ],
    citeCommand: [
      [/\s*\{/, 'delimiter', '@citeKey'],
      [/./, '', '@pop'],
    ],
    citeKey: [
      [/[^},\s]+/, 'citation.key'],
      [/[,}\s]/, 'delimiter'],
      [/}/, 'delimiter', '@pop'],
      [/./, '', '@citeKey'],
    ],
  },
};

// LaTeX commands for autocompletion
const latexSnippets = [
  {
    label: '\\begin',
    insertText: '\\begin{$1}\n\t$0\n\\end{$1}',
    documentation: 'Begin a new environment',
  },
  {
    label: '\\section',
    insertText: '\\section{$1}$0',
    documentation: 'Create a new section',
  },
  {
    label: '\\subsection',
    insertText: '\\subsection{$1}$0',
    documentation: 'Create a new subsection',
  },
  {
    label: '\\textbf',
    insertText: '\\textbf{$1}$0',
    documentation: 'Bold text',
  },
  {
    label: '\\textit',
    insertText: '\\textit{$1}$0',
    documentation: 'Italic text',
  },
  {
    label: '\\frac',
    insertText: '\\frac{$1}{$2}$0',
    documentation: 'Fraction',
  },
  { label: '\\sqrt', insertText: '\\sqrt{$1}$0', documentation: 'Square root' },
  {
    label: '\\sum',
    insertText: '\\sum_{$1}^{$2}$0',
    documentation: 'Summation',
  },
  {
    label: '\\int',
    insertText: '\\int_{$1}^{$2}$0',
    documentation: 'Integral',
  },
];

/** Builds URL with hash for bib navigation; used when Cmd+clicking a citation. */
export function getBibLinkUrl(filePath: string, lineNumber: number): string {
  if (typeof window === 'undefined') return '#';
  const hash = `#bib:${encodeURIComponent(filePath)}:${lineNumber}`;
  return `${window.location.pathname}${hash}`;
}

/**
 * Registers a link provider so citation keys in \\cite{key} are clickable (Cmd+click)
 * and navigate to the .bib file at that entry. getBibLocation should return { filePath, lineNumber } or null.
 */
export function registerCitationLinkProvider(
  monaco: typeof Monaco,
  getBibLocation: (key: string) => { filePath: string; lineNumber: number } | null
): void {
  monaco.languages.registerLinkProvider('latex', {
    provideLinks: (model) => {
      const links: Monaco.languages.ILink[] = [];
      const lineCount = model.getLineCount();
      for (let ln = 1; ln <= lineCount; ln++) {
        const line = model.getLineContent(ln);
        const citeRegex = /\\(cite[a-zA-Z]*|nocite|citeauthor|citeyear)\s*\{([^}]+)\}/g;
        let m: RegExpExecArray | null;
        while ((m = citeRegex.exec(line)) !== null) {
          const content = m[2];
          const keys = content.split(/\s*,\s*/).map((k) => k.trim()).filter(Boolean);
          const braceStartCol = m.index + m[1].length + 2;
          let searchStart = 0;
          for (const key of keys) {
            const relIdx = content.indexOf(key, searchStart);
            if (relIdx === -1) break;
            const loc = getBibLocation(key);
            if (loc) {
              const startCol = braceStartCol + relIdx + 1;
              links.push({
                range: {
                  startLineNumber: ln,
                  startColumn: startCol,
                  endLineNumber: ln,
                  endColumn: startCol + key.length,
                },
                url: getBibLinkUrl(loc.filePath, loc.lineNumber),
                tooltip: `Go to ${loc.filePath} (${key})`,
              });
            }
            searchStart = relIdx + key.length;
          }
        }
      }
      return { links };
    },
  });
}

// Completion provider with proper Monaco type
export const registerLatexCompletions = (monaco: typeof Monaco) => {
  monaco.languages.registerCompletionItemProvider('latex', {
    provideCompletionItems: (model, position) => {
      const word = model.getWordUntilPosition(position);
      const range = {
        startLineNumber: position.lineNumber,
        endLineNumber: position.lineNumber,
        startColumn: word.startColumn,
        endColumn: word.endColumn,
      };

      return {
        suggestions: latexSnippets.map((snippet) => ({
          ...snippet,
          kind: monaco.languages.CompletionItemKind.Snippet,
          insertTextRules:
            monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
          range,
        })),
      };
    },
  });
};
