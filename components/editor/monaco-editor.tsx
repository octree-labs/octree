'use client';

import { useEffect, useRef } from 'react';
import Editor, { loader } from '@monaco-editor/react';
import {
  latexLanguageConfiguration,
  latexTokenProvider,
  registerLatexCompletions,
  registerCitationLinkProvider,
} from '@/lib/editor-config';
import { registerMonacoThemes } from '@/lib/monaco-themes';
import { useEditorTheme } from '@/stores/editor-theme';
import type * as Monaco from 'monaco-editor';

interface MonacoEditorProps {
  content: string;
  onChange?: (value: string) => void;
  onMount?: (
    editor: Monaco.editor.IStandaloneCodeEditor,
    monaco: typeof Monaco
  ) => void;
  className?: string;
  options?: Monaco.editor.IStandaloneEditorConstructionOptions;
  /** Resolve citation key to .bib file path and line (for Cmd+click to bib). */
  getBibLocation?: (key: string) => { filePath: string; lineNumber: number } | null;
}

export function MonacoEditor({
  content,
  onChange,
  onMount,
  className = '',
  options = {},
  getBibLocation,
}: MonacoEditorProps) {
  const theme = useEditorTheme((state) => state.theme);
  const themesRegistered = useRef(false);

  useEffect(() => {
    loader.init().then((monaco) => {
      // Register LaTeX language
      monaco.languages.register({ id: 'latex' });
      monaco.languages.setLanguageConfiguration(
        'latex',
        latexLanguageConfiguration
      );
      monaco.languages.setMonarchTokensProvider('latex', latexTokenProvider);
      registerLatexCompletions(monaco);

      // Register custom themes (only once)
      if (!themesRegistered.current) {
        registerMonacoThemes(monaco);
        themesRegistered.current = true;
      }
    });
  }, []);

  const handleMount = (editor: Monaco.editor.IStandaloneCodeEditor, monaco: typeof Monaco) => {
    if (getBibLocation) {
      registerCitationLinkProvider(monaco, getBibLocation);
    }
    onMount?.(editor, monaco);
  };

  return (
    <div className={className}>
      <Editor
        height="100%"
        defaultLanguage="latex"
        value={content}
        onChange={(value) => onChange?.(value || '')}
        theme={theme}
        onMount={handleMount}
        options={{
          scrollbar: {
            vertical: 'auto',
            horizontal: 'auto',
            verticalScrollbarSize: 8,
            horizontalScrollbarSize: 8,
            scrollByPage: false,
            ignoreHorizontalScrollbarInContentHeight: false,
          },
          minimap: { enabled: false },
          fontSize: 13,
          wordWrap: 'on',
          lineNumbers: 'on',
          renderWhitespace: 'all',
          scrollBeyondLastLine: false,
          quickSuggestions: true,
          suggestOnTriggerCharacters: true,
          wordBasedSuggestions: 'allDocuments',
          tabCompletion: 'on',
          suggest: {
            snippetsPreventQuickSuggestions: false,
          },
          padding: {
            top: 10,
            bottom: 10,
          },
          ...options,
        }}
      />
    </div>
  );
}
