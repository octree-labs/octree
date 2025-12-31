'use client';

import { useEffect, useRef, useCallback, useState } from 'react';
import * as Y from 'yjs';
import { MonacoBinding } from 'y-monaco';
import Editor, { loader } from '@monaco-editor/react';
import type * as Monaco from 'monaco-editor';
import {
  latexLanguageConfiguration,
  latexTokenProvider,
  registerLatexCompletions,
} from '@/lib/editor-config';
import { registerMonacoThemes } from '@/lib/monaco-themes';
import { useEditorTheme } from '@/stores/editor-theme';
import { useCollaboration } from '@/hooks/use-collaboration';
import { useCollaborators } from '@/stores/collaboration';

interface CollaborativeEditorProps {
  projectId: string;
  fileId: string;
  content: string;
  onChange: (value: string) => void;
  onMount: (
    editor: Monaco.editor.IStandaloneCodeEditor,
    monaco: typeof Monaco
  ) => void;
  className?: string;
  collaborationEnabled?: boolean;
}

export function CollaborativeEditor({
  projectId,
  fileId,
  content,
  onChange,
  onMount,
  className = '',
  collaborationEnabled = true,
}: CollaborativeEditorProps) {
  const theme = useEditorTheme((state) => state.theme);
  const themesRegistered = useRef(false);
  const editorRef = useRef<Monaco.editor.IStandaloneCodeEditor | null>(null);
  const monacoRef = useRef<typeof Monaco | null>(null);
  const bindingRef = useRef<MonacoBinding | null>(null);
  const decorationsRef = useRef<string[]>([]);
  const initialContentRef = useRef<string>(content);
  const [isYjsReady, setIsYjsReady] = useState(false);
  const boundRef = useRef(false);

  const { ydoc, provider, isConnected, updateCursor, updateSelection } = useCollaboration({
    projectId,
    fileId,
    enabled: collaborationEnabled,
  });

  const collaborators = useCollaborators();

  // Store initial content when it first loads
  useEffect(() => {
    if (content && !initialContentRef.current) {
      initialContentRef.current = content;
    }
  }, [content]);

  // Initialize Monaco
  useEffect(() => {
    loader.init().then((monaco) => {
      monaco.languages.register({ id: 'latex' });
      monaco.languages.setLanguageConfiguration('latex', latexLanguageConfiguration);
      monaco.languages.setMonarchTokensProvider('latex', latexTokenProvider);
      registerLatexCompletions(monaco);

      if (!themesRegistered.current) {
        registerMonacoThemes(monaco);
        themesRegistered.current = true;
      }
    });
  }, []);

  // Bind Yjs to Monaco when both are ready
  useEffect(() => {
    if (!collaborationEnabled || !ydoc || !editorRef.current || !monacoRef.current) {
      return;
    }

    // Don't bind if already bound for this file
    if (boundRef.current) {
      return;
    }

    const editor = editorRef.current;
    const model = editor.getModel();

    if (!model) return;

    // Get or create the Yjs text type
    const yText = ydoc.getText('content');

    // Initialize Yjs with file content if empty (first user to open)
    // Wait a short time for potential sync from other users
    const initTimeout = setTimeout(() => {
      if (yText.toString() === '') {
        // No other users have content, use the file's content
        const contentToUse = initialContentRef.current || content;
        if (contentToUse) {
          ydoc.transact(() => {
            yText.insert(0, contentToUse);
          });
        }
      }

      // Now create the Monaco binding
      try {
        const binding = new MonacoBinding(
          yText,
          model,
          new Set([editor]),
          provider?.getAwareness()
        );
        bindingRef.current = binding;
        boundRef.current = true;
        setIsYjsReady(true);
      } catch (error) {
        console.error('Error creating Monaco binding:', error);
      }
    }, isConnected ? 500 : 0); // Wait 500ms if connected for sync from others

    return () => {
      clearTimeout(initTimeout);
    };
  }, [ydoc, collaborationEnabled, provider, content, isConnected]);

  // Cleanup binding when file changes or component unmounts
  useEffect(() => {
    return () => {
      if (bindingRef.current) {
        bindingRef.current.destroy();
        bindingRef.current = null;
      }
      boundRef.current = false;
      setIsYjsReady(false);
    };
  }, [fileId]);

  // Update cursor position for awareness
  const handleCursorChange = useCallback(() => {
    if (!editorRef.current || !isConnected) return;

    const position = editorRef.current.getPosition();
    if (position) {
      updateCursor({
        lineNumber: position.lineNumber,
        column: position.column,
      });
    }
  }, [isConnected, updateCursor]);

  // Update selection for awareness
  const handleSelectionChange = useCallback(() => {
    if (!editorRef.current || !isConnected) return;

    const selection = editorRef.current.getSelection();
    if (selection && !selection.isEmpty()) {
      updateSelection({
        startLineNumber: selection.startLineNumber,
        startColumn: selection.startColumn,
        endLineNumber: selection.endLineNumber,
        endColumn: selection.endColumn,
      });
    } else {
      updateSelection(null);
    }
  }, [isConnected, updateSelection]);

  // Render collaborator cursors
  useEffect(() => {
    if (!editorRef.current || !monacoRef.current || collaborators.length === 0) {
      return;
    }

    const editor = editorRef.current;
    const monaco = monacoRef.current;

    // Create decorations for each collaborator's cursor
    const newDecorations: Monaco.editor.IModelDeltaDecoration[] = [];

    collaborators.forEach((collab) => {
      if (collab.cursor) {
        // Cursor decoration
        newDecorations.push({
          range: new monaco.Range(
            collab.cursor.lineNumber,
            collab.cursor.column,
            collab.cursor.lineNumber,
            collab.cursor.column + 1
          ),
          options: {
            className: `collaborator-cursor-${collab.user_id.slice(0, 8)}`,
            beforeContentClassName: 'collaborator-cursor-line',
            hoverMessage: { value: collab.name },
            stickiness: monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
          },
        });
      }

      if (collab.selection) {
        // Selection decoration
        newDecorations.push({
          range: new monaco.Range(
            collab.selection.startLineNumber,
            collab.selection.startColumn,
            collab.selection.endLineNumber,
            collab.selection.endColumn
          ),
          options: {
            className: `collaborator-selection`,
            inlineClassName: `collaborator-selection-inline`,
            hoverMessage: { value: `${collab.name}'s selection` },
          },
        });
      }
    });

    // Apply decorations
    decorationsRef.current = editor.deltaDecorations(
      decorationsRef.current,
      newDecorations
    );
  }, [collaborators]);

  const handleEditorMount = useCallback(
    (editor: Monaco.editor.IStandaloneCodeEditor, monaco: typeof Monaco) => {
      editorRef.current = editor;
      monacoRef.current = monaco;

      // Set up cursor/selection tracking
      editor.onDidChangeCursorPosition(handleCursorChange);
      editor.onDidChangeCursorSelection(handleSelectionChange);

      // Add collaborator cursor styles
      const styleSheet = document.createElement('style');
      styleSheet.id = 'collab-cursor-styles';
      if (!document.getElementById('collab-cursor-styles')) {
        styleSheet.textContent = `
          .collaborator-cursor-line {
            border-left: 2px solid;
            margin-left: -1px;
          }
          .collaborator-selection {
            opacity: 0.3;
          }
          .collaborator-selection-inline {
            background-color: currentColor;
            opacity: 0.2;
          }
        `;
        document.head.appendChild(styleSheet);
      }

      // Call parent onMount
      onMount(editor, monaco);
    },
    [onMount, handleCursorChange, handleSelectionChange]
  );

  const handleChange = useCallback(
    (value: string | undefined) => {
      // When collaborating, changes are synced via Yjs
      // We still call onChange for local state updates (saving, etc.)
      if (value !== undefined) {
        onChange(value);
      }
    },
    [onChange]
  );

  // Determine what value to show in Monaco
  // - If Yjs is ready, let it control the content (value = undefined)
  // - If not ready yet, show the file content
  const editorValue = isYjsReady ? undefined : content;

  return (
    <div className={className}>
      <Editor
        height="100%"
        defaultLanguage="latex"
        value={editorValue}
        onChange={handleChange}
        theme={theme}
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
        }}
        onMount={handleEditorMount}
      />
    </div>
  );
}
