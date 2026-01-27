'use client';

import { useCallback } from 'react';
import { toast } from 'sonner';
import { useEditLimitCache } from '../use-edit-limit-cache';
import { useSuggestionQueue } from './use-suggestion-queue';
import { useSuggestionDecorations } from './use-suggestion-decorations';
import { acceptSingleEdit, acceptAllEdits, rejectEdit, acceptEditDirect, AcceptEditOptions } from './suggestion-operations';
import type { EditSuggestionsState, UseEditSuggestionsProps } from './types';

/**
 * Main hook for managing edit suggestions with decorations, queue, and operations
 */
export function useEditSuggestions({
  editor,
  monacoInstance,
  showInlinePreview = true,
  currentFilePath,
  onSwitchFile,
  onOtherFileEdited,
}: UseEditSuggestionsProps): EditSuggestionsState {
  // Use cached edit limit to check before requesting AI suggestions
  // Note: Quota is consumed on generation (in /api/octra-agent), not on accept
  const { canEdit } = useEditLimitCache();

  // Manage suggestions
  const {
    editSuggestions,
    setEditSuggestions,
    totalPendingCount,
    handleEditSuggestion,
  } = useSuggestionQueue({ editor });

  // Manage editor decorations
  const { decorationIds, setDecorationIds } = useSuggestionDecorations({
    editor,
    monacoInstance,
    editSuggestions,
    showInlinePreview,
    currentFilePath,
  });

  // Options for file validation and sync
  const acceptOptions: AcceptEditOptions = {
    currentFilePath,
    onSwitchFile,
    onOtherFileEdited,
  };

  // Accept a single edit
  const handleAcceptEdit = useCallback(
    async (suggestionId: string) => {
      // Fast check using cached status
      if (!canEdit) {
        toast.error(
          'You have reached your edit limit. Please upgrade to Pro for 200 edits per month.'
        );
        return;
      }

      // If editor is available, use Monaco-based editing (better for undo/redo)
      if (editor && monacoInstance) {
        await acceptSingleEdit(
          suggestionId,
          editSuggestions,
          editor,
          monacoInstance,
          setEditSuggestions,
          acceptOptions
        );
      } else {
        // No editor available - apply edit directly to file store
        acceptEditDirect(
          suggestionId,
          editSuggestions,
          setEditSuggestions,
          currentFilePath
        );
      }
    },
    [canEdit, editor, monacoInstance, editSuggestions, setEditSuggestions, currentFilePath, onSwitchFile, onOtherFileEdited]
  );

  // Accept all pending edits
  const handleAcceptAllEdits = useCallback(async () => {
    const pendingSuggestions = editSuggestions.filter((s) => s.status === 'pending');

    if (pendingSuggestions.length === 0) return;

    // Fast check using cached status
    if (!canEdit) {
      toast.error(
        'You have reached your edit limit. Please upgrade to Pro for 200 edits per month.'
      );
      return;
    }

    if (editor && monacoInstance) {
      // Use Monaco-based editing when available
      await acceptAllEdits(
        pendingSuggestions,
        editor,
        monacoInstance,
        () => {
          setEditSuggestions([]);
        },
        (appliedIds) => {
          setEditSuggestions((prev) => prev.filter((s) => !appliedIds.includes(s.id)));
        },
        acceptOptions
      );
    } else {
      // No editor - apply each edit directly to file store
      // Sort from bottom to top to avoid line shifting issues
      const sorted = [...pendingSuggestions].sort((a, b) => {
        const lineA = a.position?.line || 1;
        const lineB = b.position?.line || 1;
        return lineB - lineA;
      });

      let appliedCount = 0;
      for (const suggestion of sorted) {
        const success = acceptEditDirect(
          suggestion.id,
          editSuggestions,
          setEditSuggestions,
          currentFilePath
        );
        if (success) appliedCount++;
      }

      if (appliedCount > 0) {
        toast.success(`Applied ${appliedCount} edit(s)`, { duration: 2000 });
      }
    }
  }, [
    editSuggestions,
    canEdit,
    editor,
    monacoInstance,
    setEditSuggestions,
    currentFilePath,
    onSwitchFile,
    onOtherFileEdited,
  ]);

  // Reject a single edit
  const handleRejectEdit = useCallback(
    (suggestionId: string) => {
      rejectEdit(suggestionId, setEditSuggestions);
    },
    [setEditSuggestions]
  );

  return {
    editSuggestions,
    totalPendingCount,
    decorationIds,
    setDecorationIds,
    handleEditSuggestion,
    handleAcceptEdit,
    handleAcceptAllEdits,
    handleRejectEdit,
  };
}

