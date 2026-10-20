'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { FIRST_EDIT_NUDGE_ENABLED } from '@/data/constants';
import { AnalyticsEvents } from '@/lib/analytics/events';
import { track } from '@/lib/analytics/track';
import type { FeatureUsage } from '@/lib/subscription/features';
import {
  hasRequestedAiEdit,
  markAiEditRequested,
  markNudgeShown,
  pickNudgeSuggestions,
  shouldShowFirstEditNudge,
  usageShowsEdits,
  wasNudgeShown,
  type NudgeSuggestion,
} from '@/lib/first-edit-nudge';

interface UseFirstEditNudgeOptions {
  /** The compiled PDF; non-null means the last compile succeeded. */
  pdfData: string | null;
  /** Current editor content; read when the card is shown to pick the prompts. */
  content: string;
  /** From useSubscriptionUsage: the decision waits until this has loaded. */
  usage: FeatureUsage | null;
  usageLoading: boolean;
}

export interface FirstEditNudgeState {
  /** The three prompts to offer, or null while the card is not showing. */
  suggestions: NudgeSuggestion[] | null;
  /** The user picked one: records it and hides the card. The caller sends the prompt. */
  choose: (suggestion: NudgeSuggestion) => void;
  /** The X button. */
  dismiss: () => void;
}

/**
 * Shows the "try one AI edit" card once per user, after the first compile
 * that produces a PDF, unless they have asked for an AI edit before
 * (localStorage flag or the server's edit counters). Any AI edit while the
 * card is up (`usage-update` from the chat) closes it for good.
 */
export function useFirstEditNudge({
  pdfData,
  content,
  usage,
  usageLoading,
}: UseFirstEditNudgeOptions): FirstEditNudgeState {
  // undefined: session not read yet; null: no signed-in user.
  const [userId, setUserId] = useState<string | null | undefined>(undefined);
  const [suggestions, setSuggestions] = useState<NudgeSuggestion[] | null>(null);
  const suggestionsRef = useRef<NudgeSuggestion[] | null>(null);
  suggestionsRef.current = suggestions;
  const contentRef = useRef(content);
  contentRef.current = content;
  const decidedRef = useRef(false);

  useEffect(() => {
    if (!FIRST_EDIT_NUDGE_ENABLED) return;
    let cancelled = false;
    createClient()
      .auth.getSession()
      .then(({ data }) => {
        if (!cancelled) setUserId(data.session?.user?.id ?? null);
      })
      .catch(() => {
        if (!cancelled) setUserId(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // One decision per editor mount, taken at the first successful compile
  // once the plan has loaded (so a user whose counters show edits is never
  // flashed the card).
  useEffect(() => {
    if (decidedRef.current || !FIRST_EDIT_NUDGE_ENABLED) return;
    if (!pdfData || usageLoading || userId === undefined) return;
    decidedRef.current = true;
    if (!userId) return;

    const show = shouldShowFirstEditNudge({
      enabled: FIRST_EDIT_NUDGE_ENABLED,
      alreadyShown: wasNudgeShown(userId),
      hasEdited: hasRequestedAiEdit(userId) || usageShowsEdits(usage),
    });
    if (!show) return;

    const picked = pickNudgeSuggestions(contentRef.current);
    markNudgeShown(userId);
    setSuggestions(picked);
    track(AnalyticsEvents.FIRST_EDIT_NUDGE_SHOWN, {
      suggestions: picked.map((suggestion) => suggestion.id),
    });
  }, [pdfData, usageLoading, usage, userId]);

  // The chat dispatches `usage-update` after every AI request, whether it
  // came from the card or was typed: either way the nudge has done its job.
  useEffect(() => {
    if (!userId) return;
    const onUsageUpdate = () => {
      markAiEditRequested(userId);
      setSuggestions(null);
    };
    window.addEventListener('usage-update', onUsageUpdate);
    return () => window.removeEventListener('usage-update', onUsageUpdate);
  }, [userId]);

  const choose = useCallback(
    (suggestion: NudgeSuggestion) => {
      track(AnalyticsEvents.FIRST_EDIT_NUDGE_CLICKED, { suggestion: suggestion.id });
      if (userId) markAiEditRequested(userId);
      setSuggestions(null);
    },
    [userId]
  );

  const dismiss = useCallback(() => {
    if (!suggestionsRef.current) return;
    track(AnalyticsEvents.FIRST_EDIT_NUDGE_DISMISSED, {});
    setSuggestions(null);
  }, []);

  return { suggestions, choose, dismiss };
}
