import { languages } from 'monaco-editor';
import type * as Monaco from 'monaco-editor';
import type { CitationEntry } from '@/types/citation';

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
export const latexTokenProvider: languages.IMonarchLanguage = {
  defaultToken: '',
  tokenizer: {
    root: [
      [/\\[a-zA-Z]+/, 'keyword'],
      [/\$\$/, 'delimiter.math'],
      [/\$/, 'delimiter.math'],
      [/%.*$/, 'comment'],
      [/[{}()\[\]]/, 'delimiter'],
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

// Completion provider with proper Monaco type
export function isInsideCiteContext(text: string, offset: number): boolean {
  const before = text.slice(0, offset);
  const citeStart = before.lastIndexOf('\\cite{');
  if (citeStart === -1) return false;

  const lastCloseBefore = before.lastIndexOf('}');
  if (lastCloseBefore > citeStart) return false;

  const nextClose = text.indexOf('}', citeStart);
  return nextClose === -1 || offset <= nextClose;
}

export function getCitationKeyAtOffset(
  text: string,
  offset: number
): string | null {
  if (!isInsideCiteContext(text, offset)) return null;

  const before = text.slice(0, offset);
  const citeStart = before.lastIndexOf('\\cite{');
  const braceStart = citeStart + '\\cite{'.length;
  const braceEnd = text.indexOf('}', braceStart);
  const end = braceEnd === -1 ? text.length : braceEnd;
  const segment = text.slice(braceStart, end);

  const localOffset = Math.max(0, offset - braceStart);
  let start = localOffset;
  let finish = localOffset;

  while (start > 0 && !/[,\s]/.test(segment[start - 1])) start -= 1;
  while (finish < segment.length && !/[,\s]/.test(segment[finish])) finish += 1;

  const key = segment.slice(start, finish).trim();
  return key || null;
}

export const registerLatexCompletions = (
  monaco: typeof Monaco,
  getCitationEntries: () => CitationEntry[] = () => []
) => {
  const completionDisposable = monaco.languages.registerCompletionItemProvider(
    'latex',
    {
      triggerCharacters: ['\\', ',', '{'],
      provideCompletionItems: (model, position) => {
        const word = model.getWordUntilPosition(position);
        const range = {
          startLineNumber: position.lineNumber,
          endLineNumber: position.lineNumber,
          startColumn: word.startColumn,
          endColumn: word.endColumn,
        };

        const text = model.getValue();
        const offset = model.getOffsetAt(position);
        const inCite = isInsideCiteContext(text, offset);

        const suggestions: Monaco.languages.CompletionItem[] = latexSnippets.map(
          (snippet) => ({
          ...snippet,
          kind: monaco.languages.CompletionItemKind.Snippet,
          insertTextRules:
            monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
          range,
          })
        );

        if (inCite) {
          const citationSuggestions = getCitationEntries().map((entry) => ({
            label: entry.key,
            detail: `${entry.author} (${entry.year})`,
            documentation: entry.title,
            kind: monaco.languages.CompletionItemKind.Reference,
            insertText: entry.key,
            range,
          }));
          suggestions.push(...citationSuggestions);
        }

        return { suggestions };
      },
    }
  );

  const hoverDisposable = monaco.languages.registerHoverProvider('latex', {
    provideHover: (model, position) => {
      const text = model.getValue();
      const offset = model.getOffsetAt(position);
      const key = getCitationKeyAtOffset(text, offset);
      if (!key) return null;

      const entry = getCitationEntries().find((item) => item.key === key);
      if (!entry) return null;

      return {
        range: new monaco.Range(
          position.lineNumber,
          position.column,
          position.lineNumber,
          position.column
        ),
        contents: [
          { value: `**${entry.key}**` },
          { value: `${entry.author} (${entry.year})` },
          { value: entry.title },
          ...(entry.source ? [{ value: entry.source }] : []),
        ],
      };
    },
  });

  return {
    dispose: () => {
      completionDisposable.dispose();
      hoverDisposable.dispose();
    },
  };
};
