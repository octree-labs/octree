'use client';

import { type ReactNode, useState, useEffect, useRef } from 'react';
import { cn } from '@/lib/utils';
import { Check, Loader2, X, ChevronDown, ChevronRight } from 'lucide-react';
import { ProposalIndicator as ProposalIndicatorType } from './use-edit-proposals';
import { DiffViewer } from '../ui/diff-viewer';
import type { EditSuggestion } from '@/types/edit';

interface ChatProgressTrackerProps {
  hasContent: boolean;
  isLoading: boolean;
  proposalIndicator?: ProposalIndicatorType;
  hasGetContext?: boolean;
  /** Text generated before first tool call (after Thinking) */
  thinkingContent?: ReactNode;
  /** Text generated between context and edit tools */
  contextContent?: ReactNode;
  /** Text generated after all tool calls (before Done) */
  finalContent?: ReactNode;
  /** Accepted edit suggestions to show in collapsible "Edits applied" */
  acceptedEdits?: EditSuggestion[];
}

type StepStatus = 'pending' | 'in-progress' | 'completed' | 'error';

interface Step {
  id: string;
  label: string;
  status: StepStatus;
}

function StepIndicator({ status }: { status: StepStatus }) {
  if (status === 'pending') {
    return (
      <span
        className="flex size-3 shrink-0 items-center justify-center rounded-full border border-slate-300 bg-white"
        aria-hidden="true"
      />
    );
  }

  if (status === 'in-progress') {
    return (
      <span
        className="flex size-3 shrink-0 items-center justify-center"
        aria-hidden="true"
      >
        <Loader2 className="size-3 animate-spin text-blue-600" />
      </span>
    );
  }

  if (status === 'error') {
    return (
      <span
        className="flex size-3 shrink-0 items-center justify-center rounded-full bg-red-500 text-white"
        aria-hidden="true"
      >
        <X className="size-2" strokeWidth={3} />
      </span>
    );
  }

  return (
    <span
      className="flex size-3 shrink-0 items-center justify-center rounded-full bg-blue-600 text-white"
      aria-hidden="true"
    >
      <Check className="size-2" strokeWidth={3} />
    </span>
  );
}

function StepRow({ step, hasConnector }: { step: Step; hasConnector: boolean }) {
  return (
    <li className="relative">
      {hasConnector && (
        <div
          className="absolute w-px bg-slate-200"
          style={{ top: '18px', height: '12px', left: '5.5px' }}
          aria-hidden="true"
        />
      )}
      <div className="relative z-10 flex items-center gap-2 py-1">
        <StepIndicator status={step.status} />
        <span
          className={cn(
            'text-xs',
            step.status === 'pending' && 'text-slate-400',
            step.status === 'in-progress' && 'font-medium text-slate-700',
            step.status === 'completed' && 'text-slate-500',
            step.status === 'error' && 'font-medium text-red-600'
          )}
        >
          {step.label}
        </span>
      </div>
    </li>
  );
}

function AppliedEditsRow({
  step,
  hasConnector,
  edits,
}: {
  step: Step;
  hasConnector: boolean;
  edits: EditSuggestion[];
}) {
  const [isExpanded, setIsExpanded] = useState(false);

  return (
    <li className="relative">
      {hasConnector && (
        <div
          className="absolute w-px bg-slate-200"
          style={{ top: '18px', height: isExpanded ? 'calc(100% - 6px)' : '12px', left: '5.5px' }}
          aria-hidden="true"
        />
      )}
      <div
        role="button"
        tabIndex={0}
        onClick={() => setIsExpanded(!isExpanded)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setIsExpanded(!isExpanded);
          }
        }}
        className="relative z-10 flex items-center gap-2 py-1 cursor-pointer group"
      >
        <StepIndicator status={step.status} />
        <span className="text-xs text-slate-500">
          {step.label}
        </span>
        {edits.length > 0 && (
          <span className="text-slate-400 group-hover:text-slate-600 transition-colors">
            {isExpanded ? (
              <ChevronDown className="size-3" />
            ) : (
              <ChevronRight className="size-3" />
            )}
          </span>
        )}
        {edits.length > 1 && (
          <span className="text-[9px] text-slate-400">
            ({edits.length} edits)
          </span>
        )}
      </div>
      {isExpanded && edits.length > 0 && (
        <div className="ml-5 mt-1 mb-1 space-y-1.5">
          {edits.map((edit) => (
            <div key={edit.id} className="rounded-md border border-slate-200 bg-white overflow-hidden text-[11px]">
              <div className="flex items-center gap-1.5 px-2 py-1 bg-slate-50 border-b border-slate-100">
                {edit.file_path && (
                  <span className="text-[9px] font-medium text-slate-600 bg-slate-100 px-1 py-0.5 rounded truncate max-w-[120px]" title={edit.file_path}>
                    {edit.file_path}
                  </span>
                )}
                {edit.old_string === '' && (
                  <span className="text-[9px] font-medium text-green-600 bg-green-50 px-1 py-0.5 rounded">INS</span>
                )}
                {edit.new_string === '' && (
                  <span className="text-[9px] font-medium text-red-600 bg-red-50 px-1 py-0.5 rounded">DEL</span>
                )}
                {edit.old_string !== '' && edit.new_string !== '' && (
                  <span className="text-[9px] font-medium text-amber-600 bg-amber-50 px-1 py-0.5 rounded">REP</span>
                )}
              </div>
              <div className="px-1.5 py-1.5">
                <DiffViewer
                  original={edit.old_string}
                  suggested={edit.new_string}
                  className="max-w-full"
                />
                {edit.explanation && (
                  <p className="mt-1 px-1 text-[10px] text-slate-500 italic">
                    {edit.explanation}
                  </p>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </li>
  );
}

function ContentSegment({ children }: { children: ReactNode }) {
  return (
    <div className="relative ml-[5.5px] border-l border-slate-200 py-2 pl-4">
      <div className="min-w-0 overflow-hidden whitespace-pre-wrap break-words text-sm text-slate-800">
        {children}
      </div>
    </div>
  );
}

export function ChatProgressTracker({
  hasContent,
  isLoading,
  proposalIndicator,
  hasGetContext,
  thinkingContent,
  contextContent,
  finalContent,
  acceptedEdits = [],
}: ChatProgressTrackerProps) {
  const [completedEditRounds, setCompletedEditRounds] = useState(0);
  const prevProposalStateRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    const prevState = prevProposalStateRef.current;
    const currentState = proposalIndicator?.state;

    if (prevState === 'pending' && currentState === 'success') {
      setCompletedEditRounds((prev) => prev + 1);
    }

    prevProposalStateRef.current = currentState;
  }, [proposalIndicator?.state]);

  // Build steps
  const thinkingStep: Step = {
    id: 'thinking',
    label: 'Thinking',
    status: hasGetContext || hasContent ? 'completed' : 'in-progress',
  };

  const contextStep: Step | null = hasGetContext
    ? {
        id: 'getting-context',
        label: 'Getting context',
        status: hasContent ? 'completed' : 'in-progress',
      }
    : null;

  const editSteps: Step[] = [];
  if (hasContent) {
    if (proposalIndicator?.state === 'pending') {
      for (let i = 0; i < completedEditRounds; i++) {
        editSteps.push({ id: `proposing-${i}`, label: 'Proposing edits', status: 'completed' });
        editSteps.push({ id: `applied-${i}`, label: 'Edits applied', status: 'completed' });
      }
      editSteps.push({ id: 'proposing-current', label: 'Proposing edits', status: 'in-progress' });
    } else if (proposalIndicator?.state === 'success') {
      const totalRounds = Math.max(completedEditRounds, 1);
      for (let i = 0; i < totalRounds; i++) {
        editSteps.push({ id: `proposing-${i}`, label: 'Proposing edits', status: 'completed' });
        editSteps.push({ id: `applied-${i}`, label: 'Edits applied', status: 'completed' });
      }
    } else if (proposalIndicator?.state === 'error') {
      for (let i = 0; i < completedEditRounds; i++) {
        editSteps.push({ id: `proposing-${i}`, label: 'Proposing edits', status: 'completed' });
        editSteps.push({ id: `applied-${i}`, label: 'Edits applied', status: 'completed' });
      }
      editSteps.push({ id: 'error', label: 'Error', status: 'error' });
    }
  }

  const doneStep: Step | null =
    hasContent && !isLoading && proposalIndicator?.state !== 'error'
      ? { id: 'done', label: 'Done', status: 'completed' }
      : null;

  // Determine what comes after each section for connector lines
  const hasThinkingContent = !!thinkingContent;
  const hasContextContent = !!contextContent;
  const hasFinalContent = !!finalContent;
  const hasEditSteps = editSteps.length > 0;
  const hasDone = !!doneStep;

  const afterThinking = hasThinkingContent || !!contextStep || hasContextContent || hasEditSteps || hasFinalContent || hasDone;
  const afterContext = hasContextContent || hasEditSteps || hasFinalContent || hasDone;
  const afterEdits = hasFinalContent || hasDone;

  return (
    <div role="status" aria-live="polite">
      {/* Thinking step */}
      <ol className="m-0 flex list-none flex-col p-0">
        <StepRow step={thinkingStep} hasConnector={afterThinking} />
      </ol>

      {/* Text after thinking (before context/edit tools) */}
      {hasThinkingContent && (
        <ContentSegment>{thinkingContent}</ContentSegment>
      )}

      {/* Getting context step */}
      {contextStep && (
        <ol className="m-0 flex list-none flex-col p-0">
          <StepRow step={contextStep} hasConnector={afterContext} />
        </ol>
      )}

      {/* Text after context tools (before edit tools) */}
      {hasContextContent && (
        <ContentSegment>{contextContent}</ContentSegment>
      )}

      {/* Edit steps */}
      {hasEditSteps && (
        <ol className="m-0 flex list-none flex-col p-0">
          {editSteps.map((step, index) => {
            const isAppliedStep = step.id.startsWith('applied-');
            const hasConn = index < editSteps.length - 1 || afterEdits;
            if (isAppliedStep && acceptedEdits.length > 0) {
              return (
                <AppliedEditsRow
                  key={step.id}
                  step={step}
                  hasConnector={hasConn}
                  edits={acceptedEdits}
                />
              );
            }
            return (
              <StepRow
                key={step.id}
                step={step}
                hasConnector={hasConn}
              />
            );
          })}
        </ol>
      )}

      {/* Text after edit tools (final response) */}
      {hasFinalContent && (
        <ContentSegment>{finalContent}</ContentSegment>
      )}

      {/* Done step */}
      {doneStep && (
        <ol className="m-0 flex list-none flex-col p-0">
          <StepRow step={doneStep} hasConnector={false} />
        </ol>
      )}

      {/* Error message */}
      {proposalIndicator?.state === 'error' &&
        proposalIndicator.errorMessage && (
          <p className="ml-5 mt-0.5 text-xs text-red-500">
            {proposalIndicator.errorMessage}
          </p>
        )}
    </div>
  );
}
