import { useState, useCallback } from 'react';
import { EditSuggestion } from '@/types/edit';
import { normalizeSuggestions } from './utils';

/**
 * Manages edit suggestions
 */
export function useSuggestionQueue() {
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

      // No enrichment needed — old_string already contains the original text
      const normalized = normalizeSuggestions(incomingArray);
      setEditSuggestions((prev) => [...prev, ...normalized]);
    },
    []
  );

  const totalPendingCount = editSuggestions.filter((s) => s.status === 'pending').length;

  return {
    editSuggestions,
    setEditSuggestions,
    totalPendingCount,
    handleEditSuggestion,
  };
}
