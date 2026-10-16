'use client';

import { type ReactNode, useState, useEffect, useRef } from 'react';
import { cn } from '@/lib/utils';
import { Check, Loader2, X, ChevronDown, ChevronRight } from 'lucide-react';
import { ProposalIndicator as ProposalIndicatorType } from './use-edit-proposals';
import { DiffViewer } from '../ui/diff-viewer';
import type { EditSuggestion } from '@/types/edit';
import type { ContentSegmentData } from './chat-message';

interface RenderedSegment extends ContentSegmentData {
  renderedContent: ReactNode;
}

interface ChatProgressTrackerProps {
  hasContent: boolean;
  isLoading: boolean;
  proposalIndicator?: ProposalIndicatorType;
  hasGetContext?: boolean;
  /** Ordered segments of text and tool boundaries */
  segments: RenderedSegment[];
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

function StepRow({
  step,
  hasConnector,
}: {
  step: Step;
  hasConnector: boolean;
}) {
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
          style={{
            top: '18px',
            height: isExpanded ? 'calc(100% - 6px)' : '12px',
            left: '5.5px',
          }}
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
        className="group relative z-10 flex cursor-pointer items-center gap-2 py-1"
      >
        <StepIndicator status={step.status} />
        <span className="text-xs text-slate-500">{step.label}</span>
        {edits.length > 0 && (
          <span className="text-slate-400 transition-colors group-hover:text-slate-600">
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
        <div className="mb-1 ml-5 mt-1 space-y-1.5">
          {edits.map((edit) => (
            <div
              key={edit.id}
              className="overflow-hidden rounded-md border border-slate-200 bg-white text-[11px]"
            >
              <div className="flex items-center gap-1.5 border-b border-slate-100 bg-slate-50 px-2 py-1">
                {edit.file_path && (
                  <span
                    className="max-w-[120px] truncate rounded bg-slate-100 px-1 py-0.5 text-[9px] font-medium text-slate-600"
                    title={edit.file_path}
                  >
                    {edit.file_path}
                  </span>
                )}
                {edit.old_string === '' && (
                  <span className="rounded bg-green-50 px-1 py-0.5 text-[9px] font-medium text-green-600">
                    INS
                  </span>
                )}
                {edit.new_string === '' && (
                  <span className="rounded bg-red-50 px-1 py-0.5 text-[9px] font-medium text-red-600">
                    DEL
                  </span>
                )}
                {edit.old_string !== '' && edit.new_string !== '' && (
                  <span className="rounded bg-amber-50 px-1 py-0.5 text-[9px] font-medium text-amber-600">
                    REP
                  </span>
                )}
              </div>
              <div className="px-1.5 py-1.5">
                <DiffViewer
                  original={edit.old_string}
                  suggested={edit.new_string}
                  startLine={edit.line_start}
                  className="max-w-full"
                />
                {edit.explanation && (
                  <p className="mt-1 px-1 text-[10px] italic text-slate-500">
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
      <div className="min-w-0 overflow-hidden break-words text-sm text-slate-800">
        {children}
      </div>
    </div>
  );
}

/**
 * Build an ordered render list from segments and proposal state.
 *
 * The render list interleaves text content with step indicators, so that
 * text between multiple edit rounds is never lost when new boundaries arrive.
 */
type RenderItem =
  | { kind: 'step'; step: Step; hasConnector: boolean }
  | { kind: 'applied-edits'; step: Step; hasConnector: boolean; edits: EditSuggestion[] }
  | { kind: 'content'; content: ReactNode; key: string };

function buildRenderList(
  segments: RenderedSegment[],
  proposalIndicator: ProposalIndicatorType | undefined,
  hasGetContext: boolean | undefined,
  hasContent: boolean,
  isLoading: boolean,
  completedEditRounds: number,
  acceptedEdits: EditSuggestion[]
): RenderItem[] {
  const items: RenderItem[] = [];
  const hasProposals = !!proposalIndicator;
  const hasAnyProgress = hasGetContext || hasContent || hasProposals;

  // --- Thinking step (always first) ---
  items.push({
    kind: 'step',
    step: {
      id: 'thinking',
      label: 'Thinking',
      status: hasAnyProgress ? 'completed' : 'in-progress',
    },
    hasConnector: false, // will be fixed up at the end
  });

  // --- Walk segments in order ---
  let editRoundIndex = 0;
  // Track whether we've seen a context boundary group already
  let contextStepEmitted = false;

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];

    if (seg.type === 'text' && seg.renderedContent) {
      items.push({ kind: 'content', content: seg.renderedContent, key: `text-${i}` });
    } else if (seg.type === 'tool-boundary') {
      if (seg.toolName === 'get_context') {
        // Emit context step only once, even if there are multiple get_context boundaries
        if (!contextStepEmitted) {
          contextStepEmitted = true;
          items.push({
            kind: 'step',
            step: {
              id: 'getting-context',
              label: 'Getting context',
              status: hasContent || hasProposals ? 'completed' : 'in-progress',
            },
            hasConnector: false,
          });
        }
      } else if (seg.toolName === 'edit') {
        // Check if this edit boundary is part of a completed round or current
        const isCurrentRound = editRoundIndex >= completedEditRounds;
        if (!isCurrentRound) {
          // Completed round: proposing + applied
          items.push({
            kind: 'step',
            step: {
              id: `proposing-${editRoundIndex}`,
              label: 'Proposing edits',
              status: 'completed',
            },
            hasConnector: false,
          });
          if (acceptedEdits.length > 0) {
            items.push({
              kind: 'applied-edits',
              step: {
                id: `applied-${editRoundIndex}`,
                label: 'Edits applied',
                status: 'completed',
              },
              hasConnector: false,
              edits: acceptedEdits,
            });
          } else {
            items.push({
              kind: 'step',
              step: {
                id: `applied-${editRoundIndex}`,
                label: 'Edits applied',
                status: 'completed',
              },
              hasConnector: false,
            });
          }
          editRoundIndex++;
        } else {
          // Current/active round
          if (proposalIndicator?.state === 'pending') {
            items.push({
              kind: 'step',
              step: {
                id: 'proposing-current',
                label: 'Proposing edits',
                status: 'in-progress',
              },
              hasConnector: false,
            });
          } else if (proposalIndicator?.state === 'success') {
            items.push({
              kind: 'step',
              step: {
                id: `proposing-${editRoundIndex}`,
                label: 'Proposing edits',
                status: 'completed',
              },
              hasConnector: false,
            });
            if (acceptedEdits.length > 0) {
              items.push({
                kind: 'applied-edits',
                step: {
                  id: `applied-${editRoundIndex}`,
                  label: 'Edits applied',
                  status: 'completed',
                },
                hasConnector: false,
                edits: acceptedEdits,
              });
            } else {
              items.push({
                kind: 'step',
                step: {
                  id: `applied-${editRoundIndex}`,
                  label: 'Edits applied',
                  status: 'completed',
                },
                hasConnector: false,
              });
            }
          } else if (proposalIndicator?.state === 'error') {
            items.push({
              kind: 'step',
              step: { id: 'error', label: 'Error', status: 'error' },
              hasConnector: false,
            });
          }
          editRoundIndex++;
        }
      }
      // compile_success and other tool boundaries are noted but don't need step rows
    }
  }

  // If proposalIndicator exists but no edit boundaries were in segments yet
  // (can happen when tool event fires before any text arrives),
  // emit the edit steps that weren't covered
  if (proposalIndicator && editRoundIndex === 0) {
    if (proposalIndicator.state === 'pending') {
      for (let i = 0; i < completedEditRounds; i++) {
        items.push({
          kind: 'step',
          step: { id: `proposing-${i}`, label: 'Proposing edits', status: 'completed' },
          hasConnector: false,
        });
        if (acceptedEdits.length > 0) {
          items.push({
            kind: 'applied-edits',
            step: { id: `applied-${i}`, label: 'Edits applied', status: 'completed' },
            hasConnector: false,
            edits: acceptedEdits,
          });
        } else {
          items.push({
            kind: 'step',
            step: { id: `applied-${i}`, label: 'Edits applied', status: 'completed' },
            hasConnector: false,
          });
        }
      }
      items.push({
        kind: 'step',
        step: { id: 'proposing-current', label: 'Proposing edits', status: 'in-progress' },
        hasConnector: false,
      });
    } else if (proposalIndicator.state === 'success') {
      const totalRounds = Math.max(completedEditRounds, 1);
      for (let i = 0; i < totalRounds; i++) {
        items.push({
          kind: 'step',
          step: { id: `proposing-${i}`, label: 'Proposing edits', status: 'completed' },
          hasConnector: false,
        });
        if (acceptedEdits.length > 0) {
          items.push({
            kind: 'applied-edits',
            step: { id: `applied-${i}`, label: 'Edits applied', status: 'completed' },
            hasConnector: false,
            edits: acceptedEdits,
          });
        } else {
          items.push({
            kind: 'step',
            step: { id: `applied-${i}`, label: 'Edits applied', status: 'completed' },
            hasConnector: false,
          });
        }
      }
    } else if (proposalIndicator.state === 'error') {
      for (let i = 0; i < completedEditRounds; i++) {
        items.push({
          kind: 'step',
          step: { id: `proposing-${i}`, label: 'Proposing edits', status: 'completed' },
          hasConnector: false,
        });
        if (acceptedEdits.length > 0) {
          items.push({
            kind: 'applied-edits',
            step: { id: `applied-${i}`, label: 'Edits applied', status: 'completed' },
            hasConnector: false,
            edits: acceptedEdits,
          });
        } else {
          items.push({
            kind: 'step',
            step: { id: `applied-${i}`, label: 'Edits applied', status: 'completed' },
            hasConnector: false,
          });
        }
      }
      items.push({
        kind: 'step',
        step: { id: 'error', label: 'Error', status: 'error' },
        hasConnector: false,
      });
    }
  }

  // --- Thinking gap (while loading, at the end) ---
  if (isLoading && hasAnyProgress) {
    items.push({
      kind: 'step',
      step: { id: 'thinking-gap', label: 'Thinking', status: 'in-progress' },
      hasConnector: false,
    });
  }

  // --- Done step ---
  if (!isLoading && proposalIndicator?.state !== 'error' && hasAnyProgress) {
    items.push({
      kind: 'step',
      step: { id: 'done', label: 'Done', status: 'completed' },
      hasConnector: false,
    });
  }

  // --- Fix up connector lines: each step/applied-edits has a connector if something follows ---
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (item.kind === 'step' || item.kind === 'applied-edits') {
      item.hasConnector = i < items.length - 1;
    }
  }

  return items;
}

export function ChatProgressTracker({
  hasContent,
  isLoading,
  proposalIndicator,
  hasGetContext,
  segments,
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

  const renderItems = buildRenderList(
    segments,
    proposalIndicator,
    hasGetContext,
    hasContent,
    isLoading,
    completedEditRounds,
    acceptedEdits
  );

  return (
    <div role="status" aria-live="polite">
      {renderItems.map((item) => {
        if (item.kind === 'content') {
          return <ContentSegment key={item.key}>{item.content}</ContentSegment>;
        }
        if (item.kind === 'applied-edits') {
          return (
            <ol key={item.step.id} className="m-0 flex list-none flex-col p-0">
              <AppliedEditsRow
                step={item.step}
                hasConnector={item.hasConnector}
                edits={item.edits}
              />
            </ol>
          );
        }
        // kind === 'step'
        return (
          <ol key={item.step.id} className="m-0 flex list-none flex-col p-0">
            <StepRow step={item.step} hasConnector={item.hasConnector} />
          </ol>
        );
      })}

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
