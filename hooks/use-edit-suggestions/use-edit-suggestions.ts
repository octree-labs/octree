'use client';

import { useCallback } from 'react';
import { toast } from 'sonner';
import { useEditLimitCache } from '../use-edit-limit-cache';
import { PRO_MONTHLY_EDIT_LIMIT } from '@/data/constants';
import { PaywallActions } from '@/stores/paywall';
import { AnalyticsEvents } from '@/lib/analytics/events';
import { track } from '@/lib/analytics/track';
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
  const { canEdit, isPro } = useEditLimitCache();

  // Free users get the paywall; Pro users at their monthly cap get a message,
  // since upgrading would not help them.
  const notifyLimitReached = useCallback(() => {
    track(AnalyticsEvents.EDIT_LIMIT_HIT, { is_pro: isPro, source: 'accept' });
    if (isPro) {
      toast.error(
        `You've reached your monthly limit of ${PRO_MONTHLY_EDIT_LIMIT} AI edits. It resets on your billing date.`
      );
    } else {
      PaywallActions.open('ai-edit');
    }
  }, [isPro]);

  // Manage suggestions — no editor reference needed for string-matching edits
  const {
    editSuggestions,
    setEditSuggestions,
    totalPendingCount,
    handleEditSuggestion,
  } = useSuggestionQueue();

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

  // Accept a single edit — Monaco path with direct fallback
  const handleAcceptEdit = useCallback(
    async (suggestionId: string) => {
      const suggestion = editSuggestions.find((s) => s.id === suggestionId);
      if (!canEdit && suggestion?.source !== 'ats') {
        notifyLimitReached();
        return;
      }

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
        acceptEditDirect(
          suggestionId,
          editSuggestions,
          setEditSuggestions,
          currentFilePath,
          onOtherFileEdited
        );
      }
      if (suggestion?.source !== 'ats') {
        track(AnalyticsEvents.AI_EDIT_ACCEPTED, { count: 1, mode: 'single' });
      }
    },
    [canEdit, notifyLimitReached, editor, monacoInstance, editSuggestions, setEditSuggestions, currentFilePath, onSwitchFile, onOtherFileEdited]
  );

  // Accept all pending edits — Monaco if model ready, else direct fallback
  const handleAcceptAllEdits = useCallback(async () => {
    const pendingSuggestions = editSuggestions.filter((s) => s.status === 'pending');

    if (pendingSuggestions.length === 0) return;

    // ATS fixes don't spend AI edits; only AI chat edits need the allowance.
    const aiEditCount = pendingSuggestions.filter((s) => s.source !== 'ats').length;
    if (!canEdit && aiEditCount > 0) {
      notifyLimitReached();
      return;
    }

    if (aiEditCount > 0) {
      track(AnalyticsEvents.AI_EDIT_ACCEPTED, {
        count: aiEditCount,
        mode: 'all',
      });
    }

    // Use Monaco if editor model is available, otherwise fall back to direct
    if (editor && monacoInstance && editor.getModel()) {
      await acceptAllEdits(
        pendingSuggestions,
        editor,
        monacoInstance,
        () => {
          setEditSuggestions((prev) =>
            prev.map((s) => s.status === 'pending' ? { ...s, status: 'accepted' as const } : s)
          );
        },
        (appliedIds) => {
          setEditSuggestions((prev) =>
            prev.map((s) => appliedIds.includes(s.id) ? { ...s, status: 'accepted' as const } : s)
          );
        },
        acceptOptions
      );
    } else {
      // No editor model — apply directly to file store
      for (const suggestion of pendingSuggestions) {
        acceptEditDirect(
          suggestion.id,
          editSuggestions,
          setEditSuggestions,
          currentFilePath,
          onOtherFileEdited
        );
      }
    }
  }, [
    editSuggestions,
    canEdit,
    notifyLimitReached,
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
