import { useState, useEffect } from 'react';
import { EditSuggestion } from '@/types/edit';
import type * as Monaco from 'monaco-editor';
import { getStartLine, getOriginalLineCount, getSuggestedText } from './utils';

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
    // Ensure editor and monaco are ready
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
      // If suggestion has no target file, show it
      if (!s.targetFile) return true;
      // If we don't know current file, show all
      if (!currentFilePath) return true;
      // Only show if target matches current file
      return s.targetFile === currentFilePath;
    });

    pendingSuggestions.forEach((suggestion) => {
      const startLineNumber = getStartLine(suggestion);
      const originalLineCount = getOriginalLineCount(suggestion);
      const suggestedText = getSuggestedText(suggestion);
      
      // Ensure endLineNumber is valid and >= startLineNumber
      const endLineNumber = Math.max(
        startLineNumber,
        startLineNumber + originalLineCount - 1
      );

      // Validate line numbers against the current model state
      if (
        startLineNumber <= 0 ||
        endLineNumber <= 0 ||
        startLineNumber > model.getLineCount() ||
        endLineNumber > model.getLineCount()
      ) {
        console.warn(
          `Suggestion ${suggestion.id} line numbers [${startLineNumber}-${endLineNumber}] are out of bounds for model line count ${model.getLineCount()}. Skipping decoration.`
        );
        return;
      }

      // Calculate end column precisely
      const endColumn =
        originalLineCount > 0
          ? model.getLineMaxColumn(endLineNumber)
          : 1;

      // Define the range for the original text (or insertion point)
      const originalRange = new monacoInstance.Range(
        startLineNumber,
        1,
        endLineNumber,
        endColumn
      );

      // Decoration 1: Mark original text (if any) + Glyph
      if (originalLineCount > 0) {
        // Apply red strikethrough to the original range
        newDecorations.push({
          range: originalRange,
          options: {
            className: 'octra-suggestion-deleted',
            glyphMarginClassName: 'octra-suggestion-glyph',
            glyphMarginHoverMessage: {
              value: `Suggestion: Replace Lines ${startLineNumber}-${endLineNumber}`,
            },
            stickiness:
              monacoInstance.editor.TrackedRangeStickiness
                .NeverGrowsWhenTypingAtEdges,
          },
        });
      } else {
        // If it's a pure insertion, just add the glyph marker at the start line
        newDecorations.push({
          range: new monacoInstance.Range(
            startLineNumber,
            1,
            startLineNumber,
            1
          ),
          options: {
            glyphMarginClassName: 'octra-suggestion-glyph',
            glyphMarginHoverMessage: {
              value: `Suggestion: Insert at Line ${startLineNumber}`,
            },
            stickiness:
              monacoInstance.editor.TrackedRangeStickiness
                .NeverGrowsWhenTypingAtEdges,
          },
        });
      }

      // Decoration 2: Show suggested text inline (if any and allowed)
      if (showInlinePreview && suggestedText && suggestedText.trim().length > 0) {
        const afterWidgetRange = new monacoInstance.Range(
          endLineNumber,
          endColumn,
          endLineNumber,
          endColumn
        );

        // Prepare suggested content, replacing newlines for inline view
        const inlineSuggestedContent = ` ${suggestedText.replace(/\n/g, ' ↵ ')}`;

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

