import { useState, useEffect } from 'react';
import { EditSuggestion } from '@/types/edit';
import type * as Monaco from 'monaco-editor';
import { findOldStringRange } from './utils';

interface UseSuggestionDecorationsProps {
  editor: Monaco.editor.IStandaloneCodeEditor | null;
  monacoInstance: typeof Monaco | null;
  editSuggestions: EditSuggestion[];
  showInlinePreview?: boolean;
  currentFilePath?: string | null;
}

/**
 * Manages Monaco editor decorations for edit suggestions
 */
export function useSuggestionDecorations({
  editor,
  monacoInstance,
  editSuggestions,
  showInlinePreview = true,
  currentFilePath,
}: UseSuggestionDecorationsProps) {
  const [decorationIds, setDecorationIds] = useState<string[]>([]);

  useEffect(() => {
    if (!editor || !monacoInstance) {
      return;
    }

    const model = editor.getModel();
    if (!model) {
      return;
    }

    const oldDecorationIds = decorationIds;
    const newDecorations: Monaco.editor.IModelDeltaDecoration[] = [];

    // Only show decorations for pending suggestions that target the current file
    const pendingSuggestions = editSuggestions.filter((s) => {
      if (s.status !== 'pending') return false;
      if (!s.file_path) return true;
      if (!currentFilePath) return true;
      return s.file_path === currentFilePath;
    });

    pendingSuggestions.forEach((suggestion) => {
      if (suggestion.old_string === '') {
        // Create/append: decoration at end of file
        const lastLine = model.getLineCount();
        const lastCol = model.getLineMaxColumn(lastLine);

        newDecorations.push({
          range: new monacoInstance.Range(lastLine, lastCol, lastLine, lastCol),
          options: {
            glyphMarginClassName: 'octra-suggestion-glyph',
            glyphMarginHoverMessage: {
              value: `Suggestion: Append to end of file`,
            },
            stickiness:
              monacoInstance.editor.TrackedRangeStickiness
                .NeverGrowsWhenTypingAtEdges,
          },
        });

        // Show suggested text inline
        if (showInlinePreview && suggestion.new_string && suggestion.new_string.trim().length > 0) {
          const inlineSuggestedContent = ` ${suggestion.new_string.replace(/\n/g, ' ↵ ')}`;
          newDecorations.push({
            range: new monacoInstance.Range(lastLine, lastCol, lastLine, lastCol),
            options: {
              after: {
                content: inlineSuggestedContent,
                inlineClassName: 'octra-suggestion-added',
              },
              stickiness:
                monacoInstance.editor.TrackedRangeStickiness
                  .NeverGrowsWhenTypingAtEdges,
            },
          });
        }

        return;
      }

      // Find the old_string range in the model
      const matchRange = findOldStringRange(model, suggestion.old_string);
      if (!matchRange) {
        console.warn(
          `Suggestion ${suggestion.id}: old_string not uniquely found in model. Skipping decoration.`
        );
        return;
      }

      // Decoration 1: Red strikethrough on matched range
      if (suggestion.new_string !== '') {
        // Replace: strikethrough + glyph
        newDecorations.push({
          range: matchRange,
          options: {
            className: 'octra-suggestion-deleted',
            glyphMarginClassName: 'octra-suggestion-glyph',
            glyphMarginHoverMessage: {
              value: `Suggestion: Replace text`,
            },
            stickiness:
              monacoInstance.editor.TrackedRangeStickiness
                .NeverGrowsWhenTypingAtEdges,
          },
        });
      } else {
        // Delete: strikethrough + glyph
        newDecorations.push({
          range: matchRange,
          options: {
            className: 'octra-suggestion-deleted',
            glyphMarginClassName: 'octra-suggestion-glyph',
            glyphMarginHoverMessage: {
              value: `Suggestion: Delete text`,
            },
            stickiness:
              monacoInstance.editor.TrackedRangeStickiness
                .NeverGrowsWhenTypingAtEdges,
          },
        });
      }

      // Decoration 2: Show new_string inline preview after the range
      if (showInlinePreview && suggestion.new_string && suggestion.new_string.trim().length > 0) {
        const afterWidgetRange = new monacoInstance.Range(
          matchRange.endLineNumber,
          matchRange.endColumn,
          matchRange.endLineNumber,
          matchRange.endColumn
        );

        const inlineSuggestedContent = ` ${suggestion.new_string.replace(/\n/g, ' ↵ ')}`;

        newDecorations.push({
          range: afterWidgetRange,
          options: {
            after: {
              content: inlineSuggestedContent,
              inlineClassName: 'octra-suggestion-added',
            },
            stickiness:
              monacoInstance.editor.TrackedRangeStickiness
                .NeverGrowsWhenTypingAtEdges,
          },
        });
      }
    });

    // Apply decorations atomically
    const newDecorationIds = editor.deltaDecorations(
      oldDecorationIds,
      newDecorations
    );
    setDecorationIds(newDecorationIds);
  }, [editSuggestions, editor, monacoInstance, showInlinePreview, currentFilePath]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (editor && decorationIds.length > 0) {
        editor.deltaDecorations(decorationIds, []);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    decorationIds,
    setDecorationIds,
  };
}
