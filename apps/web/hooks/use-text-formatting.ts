'use client';

import { useCallback } from 'react';
import type * as Monaco from 'monaco-editor';

export interface TextFormattingState {
  handleTextFormat: (format: 'bold' | 'italic' | 'underline') => void;
}

interface UseTextFormattingProps {
  editorRef: React.MutableRefObject<Monaco.editor.IStandaloneCodeEditor | null>;
}

export function useTextFormatting({
  editorRef,
}: UseTextFormattingProps): TextFormattingState {
  const handleTextFormat = useCallback(
    (format: 'bold' | 'italic' | 'underline') => {
      const editor = editorRef.current;
      if (!editor) return;

      const selection = editor.getSelection();
      if (!selection || selection.isEmpty()) return;

      const model = editor.getModel();
      if (!model) return;

      const selectedText = model.getValueInRange(selection);

      const formatMap = {
        bold: { command: '\\textbf', length: 8 },
        italic: { command: '\\textit', length: 8 },
        underline: { command: '\\underline', length: 11 },
      };

      const { command, length } = formatMap[format];
      let newText;
      if (selectedText.startsWith(`${command}{`) && selectedText.endsWith('}')) {
        // Remove formatting if already present
        newText = selectedText.slice(length, -1);
      } else {
        // Add formatting
        newText = `${command}{${selectedText}}`;
      }

      editor.executeEdits(format, [
        {
          range: selection,
          text: newText,
          forceMoveMarkers: true,
        },
      ]);

      editor.focus();
    },
    [editorRef]
  );

  return {
    handleTextFormat,
  };
}
