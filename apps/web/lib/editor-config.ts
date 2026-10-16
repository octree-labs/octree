import { languages } from 'monaco-editor';
import type * as Monaco from 'monaco-editor';

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
