import { useState, useCallback } from 'react';
import { EditSuggestion } from '@/types/edit';
import { normalizeSuggestions, getOriginalTextFromModel, getStartLine, getOriginalLineCount } from './utils';
import type * as Monaco from 'monaco-editor';

interface UseSuggestionQueueProps {
  editor: Monaco.editor.IStandaloneCodeEditor | null;
}

/**
 * Manages edit suggestions
 */
export function useSuggestionQueue({ editor }: UseSuggestionQueueProps) {
  const [editSuggestions, setEditSuggestions] = useState<EditSuggestion[]>([]);

  const handleEditSuggestion = useCallback(
    (suggestionInput: EditSuggestion | EditSuggestion[]) => {
      const incomingArray = Array.isArray(suggestionInput)
        ? suggestionInput
        : [suggestionInput];

      if (incomingArray.length === 0) {
        setEditSuggestions([]);
        return;
      }

      // Enrich suggestions with original text from the current model when missing
      const model: Monaco.editor.ITextModel | null = editor ? editor.getModel() : null;

      const withOriginals = incomingArray.map((s) => {
        if (s.original !== undefined || !model) return s;
        return {
          ...s,
          original: getOriginalTextFromModel(model, getStartLine(s), getOriginalLineCount(s)),
        };
      });

      const normalized = normalizeSuggestions(withOriginals);
      setEditSuggestions(normalized);
    },
    [editor]
  );

  const totalPendingCount = editSuggestions.filter((s) => s.status === 'pending').length;

  return {
    editSuggestions,
    setEditSuggestions,
    totalPendingCount,
    handleEditSuggestion,
  };
}

