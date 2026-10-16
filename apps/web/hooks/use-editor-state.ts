'use client';

import { useState, useRef } from 'react';
import type * as Monaco from 'monaco-editor';
import { useFileContent, FileActions } from '@/stores/file';

export interface EditorState {
  content: string;
  setContent: (content: string) => void;
  editor: Monaco.editor.IStandaloneCodeEditor | null;
  setEditor: (editor: Monaco.editor.IStandaloneCodeEditor | null) => void;
  monacoInstance: typeof Monaco | null;
  setMonacoInstance: (monaco: typeof Monaco | null) => void;
  editorRef: React.MutableRefObject<Monaco.editor.IStandaloneCodeEditor | null>;
}

export function useEditorState(): EditorState {
  const fileContent = useFileContent();
  const content = fileContent ?? '';
  const setContent = FileActions.setContent;
  const [editor, setEditor] =
    useState<Monaco.editor.IStandaloneCodeEditor | null>(null);
  const [monacoInstance, setMonacoInstance] = useState<typeof Monaco | null>(
    null
  );
  const editorRef = useRef<Monaco.editor.IStandaloneCodeEditor | null>(null);

  return {
    content,
    setContent,
    editor,
    setEditor,
    monacoInstance,
    setMonacoInstance,
    editorRef,
  };
}
