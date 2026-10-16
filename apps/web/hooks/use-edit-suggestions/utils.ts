import { EditSuggestion } from '@/types/edit';
import type * as Monaco from 'monaco-editor';

/**
 * Utility functions for working with string-matching edit suggestions
 */

/**
 * Find the range where old_string appears in the Monaco model.
 * Returns null if not found or not unique.
 */
export function findOldStringRange(
  model: Monaco.editor.ITextModel,
  oldString: string
): Monaco.Range | null {
  if (!oldString) return null;

  const matches = model.findMatches(
    oldString,
    false, // searchOnlyEditableRange
    false, // isRegex
    true,  // matchCase
    null,  // wordSeparators
    false  // captureMatches
  );

  if (matches.length !== 1) return null;
  return matches[0].range;
}

/**
 * Check if a suggestion's old_string is still uniquely matchable in the model
 */
export function isSuggestionStillValid(
  model: Monaco.editor.ITextModel,
  suggestion: EditSuggestion
): boolean {
  // Insert/append (empty old_string) is always valid
  if (!suggestion.old_string) return true;

  const matches = model.findMatches(
    suggestion.old_string,
    false,
    false,
    true,
    null,
    false
  );

  return matches.length === 1;
}

/**
 * Normalize newlines to \n
 */
export function normalizeNewlines(text: string): string {
  return text.replace(/\r\n?/g, '\n');
}

/**
 * Normalize suggestions to ensure consistent status
 */
export function normalizeSuggestions(suggestions: EditSuggestion[]): EditSuggestion[] {
  return suggestions.map((suggestion) => ({
    ...suggestion,
    status: 'pending' as const,
  }));
}
