'use client';

import { Check, CircleCheck, Loader2, TriangleAlert } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import PDFViewer from '@/components/pdf-viewer';
import { cn } from '@/lib/utils';
import type { CoverageReport, ResumeSuggestion } from '@/types/resume';

export type SuggestionStatus = 'pending' | 'applied' | 'dismissed';

function PdfFrame({
  pdfData,
  isLoading,
}: {
  pdfData: string;
  isLoading?: boolean;
}) {
  return (
    <div className="flex min-w-0 flex-col">
      <p className="mb-2 flex h-7 items-center text-sm font-medium text-neutral-700">
        Redesigned
      </p>
      <div className="relative h-[75vh] overflow-hidden rounded-xl border bg-white">
        <PDFViewer pdfData={pdfData} />
        {isLoading && (
          <div className="absolute inset-0 flex items-center justify-center bg-white/70">
            <Loader2 className="size-6 animate-spin text-primary" />
          </div>
        )}
      </div>
    </div>
  );
}

// One line under the preview: an all-clear, or which words may be missing.
function CoverageLine({ coverage }: { coverage: CoverageReport }) {
  const { missing } = coverage;
  if (missing.length === 0) {
    return (
      <p className="mt-4 flex items-center gap-1.5 text-sm text-green-700">
        <CircleCheck className="size-4 shrink-0" />
        All of your original content made it into the new version.
      </p>
    );
  }
  return (
    <p
      className="mt-4 flex items-center gap-1.5 text-sm text-amber-700"
      title={missing.join(', ')}
    >
      <TriangleAlert className="size-4 shrink-0" />
      <span className="truncate">
        {missing.length} word{missing.length === 1 ? '' : 's'} may be missing:{' '}
        <span className="font-mono text-xs">{missing.slice(0, 20).join(', ')}</span>
      </span>
    </p>
  );
}

function SuggestionCard({
  suggestion,
  status,
  disabled,
  onApply,
  onDismiss,
}: {
  suggestion: ResumeSuggestion;
  status: SuggestionStatus;
  disabled: boolean;
  onApply: () => void;
  onDismiss: () => void;
}) {
  return (
    <li
      className={cn(
        'rounded-lg border p-3 text-sm',
        status !== 'pending' && 'bg-neutral-50 opacity-60'
      )}
    >
      <div className="mb-1 flex items-center justify-between gap-2">
        <p className="font-medium text-neutral-900">{suggestion.title}</p>
        <Badge variant="outline" className="shrink-0 capitalize">
          {suggestion.category}
        </Badge>
      </div>
      <p className="mb-2 text-neutral-600">{suggestion.reason}</p>
      <div className="mb-3 space-y-1 rounded-md bg-neutral-50 p-2 font-mono text-xs">
        <p className="break-words text-red-700 line-through">{suggestion.find}</p>
        <p className="break-words text-green-700">{suggestion.replace}</p>
      </div>
      {status === 'pending' ? (
        <div className="flex gap-2">
          <Button size="xs" onClick={onApply} disabled={disabled}>
            Apply
          </Button>
          <Button size="xs" variant="ghost" onClick={onDismiss} disabled={disabled}>
            Dismiss
          </Button>
        </div>
      ) : (
        <p className="flex items-center gap-1 text-xs text-neutral-500">
          {status === 'applied' && <Check className="size-3" />}
          {status === 'applied' ? 'Applied' : 'Dismissed'}
        </p>
      )}
    </li>
  );
}

export function ResumeReview({
  pdfData,
  coverage,
  suggestions,
  statuses,
  isRecompiling,
  isOpening,
  onApply,
  onApplyAll,
  onDismiss,
  onDiscard,
  onOpenInEditor,
}: {
  pdfData: string; // base64
  coverage: CoverageReport;
  suggestions: ResumeSuggestion[];
  statuses: Record<string, SuggestionStatus>;
  isRecompiling: boolean;
  isOpening: boolean;
  onApply: (suggestion: ResumeSuggestion) => void;
  onApplyAll: () => void;
  onDismiss: (suggestion: ResumeSuggestion) => void;
  onDiscard: () => void;
  onOpenInEditor: () => void;
}) {
  const pendingCount = suggestions.filter((s) => statuses[s.id] === 'pending').length;
  const busy = isRecompiling || isOpening;

  return (
    <div>
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-lg font-semibold text-neutral-900">Review your new resume</h1>
          <p className="text-sm text-neutral-500">
            Apply any fixes you want, then open it in the editor to keep working.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={onDiscard} disabled={busy}>
            Discard
          </Button>
          <Button size="sm" onClick={onOpenInEditor} disabled={busy}>
            {isOpening && <Loader2 className="size-4 animate-spin" />}
            Open in editor
          </Button>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        <div className="min-w-0">
          <PdfFrame pdfData={pdfData} isLoading={isRecompiling} />
          <CoverageLine coverage={coverage} />
        </div>

        <aside className="flex min-w-0 flex-col">
          <div className="mb-2 flex h-7 items-center justify-between">
            <p className="text-sm font-medium text-neutral-700">
              Suggested fixes{suggestions.length > 0 && ` (${suggestions.length})`}
            </p>
            {pendingCount > 1 && (
              <Button size="xs" variant="outline" onClick={onApplyAll} disabled={busy}>
                Apply all
              </Button>
            )}
          </div>
          <div className="h-[75vh] overflow-y-auto rounded-xl border bg-white p-2">
            {suggestions.length === 0 ? (
              <p className="p-2 text-sm text-neutral-500">No obvious mistakes found.</p>
            ) : (
              <ul className="space-y-2">
                {suggestions.map((s) => (
                  <SuggestionCard
                    key={s.id}
                    suggestion={s}
                    status={statuses[s.id]}
                    disabled={busy}
                    onApply={() => onApply(s)}
                    onDismiss={() => onDismiss(s)}
                  />
                ))}
              </ul>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
