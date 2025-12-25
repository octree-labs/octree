'use client';

import { useCallback } from 'react';
import { toast } from 'sonner';
import { useEditLimitCache } from '../use-edit-limit-cache';
import { useSuggestionQueue } from './use-suggestion-queue';
import { useSuggestionDecorations } from './use-suggestion-decorations';
import { acceptSingleEdit, acceptAllEdits, rejectEdit, AcceptEditOptions } from './suggestion-operations';
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
  });

  // Options for file validation
  const acceptOptions: AcceptEditOptions = {
    currentFilePath,
    onSwitchFile,
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

      if (!editor || !monacoInstance) {
        console.error('Editor or Monaco instance not available.');
        return;
      }

      await acceptSingleEdit(
        suggestionId,
        editSuggestions,
        editor,
        monacoInstance,
        setEditSuggestions,
        acceptOptions
      );
    },
    [canEdit, editor, monacoInstance, editSuggestions, setEditSuggestions, currentFilePath, onSwitchFile]
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

    if (!editor || !monacoInstance) {
      console.error('Editor or Monaco instance not available.');
      return;
    }

    await acceptAllEdits(
      pendingSuggestions,
      editor,
      monacoInstance,
      () => {
        setEditSuggestions([]);
      },
      (appliedIds) => {
        // Partial clear: remove only applied edits
        setEditSuggestions((prev) => prev.filter((s) => !appliedIds.includes(s.id)));
      },
      acceptOptions
    );
  }, [
    editSuggestions,
    canEdit,
    editor,
    monacoInstance,
    setEditSuggestions,
    currentFilePath,
    onSwitchFile,
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

