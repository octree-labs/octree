'use client';

import { WandSparkles, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { FREE_DAILY_EDIT_LIMIT } from '@/data/constants';
import type { NudgeSuggestion } from '@/lib/first-edit-nudge';

interface FirstEditNudgeProps {
  suggestions: NudgeSuggestion[];
  onChoose: (suggestion: NudgeSuggestion) => void;
  onDismiss: () => void;
  /** Free users see the daily allowance under the prompts. */
  showFreeAllowance?: boolean;
}

/**
 * The strip above the PDF preview after a user's first successful compile:
 * one line and three one-click AI edit prompts. It sits in the preview
 * pane's flow (not over the PDF) and is gone after a click or the X.
 */
export function FirstEditNudge({
  suggestions,
  onChoose,
  onDismiss,
  showFreeAllowance = false,
}: FirstEditNudgeProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="first-edit-nudge"
      className="flex shrink-0 items-start gap-3 border-b border-primary/20 bg-primary/5 px-3 py-2.5"
    >
      <WandSparkles className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-slate-900">
          Your PDF is ready. Try one AI edit on it:
        </p>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {suggestions.map((suggestion) => (
            <Button
              key={suggestion.id}
              type="button"
              variant="outline"
              size="xs"
              onClick={() => onChoose(suggestion)}
              className="rounded-full border-primary/30 bg-white text-slate-700 hover:border-primary hover:text-primary"
            >
              {suggestion.label}
            </Button>
          ))}
        </div>
        {showFreeAllowance && (
          <p className="mt-1.5 text-xs text-slate-500">
            {FREE_DAILY_EDIT_LIMIT} free AI edits a day. Changes land in the editor and you can
            restore the previous version from the chat.
          </p>
        )}
      </div>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        onClick={onDismiss}
        aria-label="Dismiss"
        className="size-7 shrink-0 text-slate-500 hover:text-slate-900"
      >
        <X className="size-4" />
      </Button>
    </div>
  );
}
