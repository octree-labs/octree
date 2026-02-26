import { useState, useRef, useCallback, useEffect } from 'react';
import { StringEdit } from '@/lib/octra-agent/edits';
import { EditSuggestion } from '@/types/edit';

export type ProposalState = 'pending' | 'success' | 'error';
export type ProposalStepState = 'queued' | 'pending' | 'success';

export interface ProposalIndicator {
  state: ProposalState;
  count?: number;
  progressCount?: number;
  stepStates?: ProposalStepState[];
  violations?: number;
  errorMessage?: string;
}

const STEP_CASCADE_DELAY_MS = 180;
const MIN_SUCCESS_DELAY_MS = 800;
const POST_CASCADE_BUFFER_MS = 160;

function buildStepStates(total: number, progress: number): ProposalStepState[] {
  const normalizedTotal = Math.max(1, total || 0);
  const clampedProgress = Math.max(0, Math.min(progress, normalizedTotal));

  return Array.from({ length: normalizedTotal }, (_, index) => {
    if (index < clampedProgress) return 'success';
    if (index === clampedProgress) return 'pending';
    return 'queued';
  });
}

export function useEditProposals(
  fileContent: string,
  projectFiles: { path: string; content: string }[] = [],
  currentFilePath: string | null = null
) {
  const [proposalIndicators, setProposalIndicators] = useState<
    Record<string, ProposalIndicator>
  >({});
  const processedEditsRef = useRef<Set<string>>(new Set());
  const pendingTimestampRef = useRef<Record<string, number>>({});
  const progressTimeoutsRef = useRef<Record<string, number[]>>({});
  const eventProgressRef = useRef<Record<string, boolean>>({});
  const editIdCounterRef = useRef(0);

  const fileContentRef = useRef(fileContent);
  const projectFilesRef = useRef(projectFiles);
  const currentFilePathRef = useRef(currentFilePath);

  useEffect(() => {
    fileContentRef.current = fileContent;
  }, [fileContent]);
  useEffect(() => {
    projectFilesRef.current = projectFiles;
  }, [projectFiles]);
  useEffect(() => {
    currentFilePathRef.current = currentFilePath;
  }, [currentFilePath]);

  const clearProposals = useCallback(() => {
    processedEditsRef.current.clear();
    setProposalIndicators((prev) => {
      const retained: Record<string, ProposalIndicator> = {};
      Object.entries(prev).forEach(([messageId, indicator]) => {
        if (indicator.state === 'success') {
          retained[messageId] = indicator;
        }
      });
      return retained;
    });
    Object.values(progressTimeoutsRef.current).forEach((timeouts) => {
      timeouts.forEach((timeoutId) => window.clearTimeout(timeoutId));
    });
    progressTimeoutsRef.current = {};
    pendingTimestampRef.current = {};
    eventProgressRef.current = {};
  }, []);

  const clearAllProposalsAndTimeouts = useCallback(() => {
    Object.values(progressTimeoutsRef.current).forEach((timeouts) => {
      timeouts.forEach((timeoutId) => window.clearTimeout(timeoutId));
    });
    progressTimeoutsRef.current = {};
    pendingTimestampRef.current = {};
    eventProgressRef.current = {};
    processedEditsRef.current.clear();

    setProposalIndicators((prev) => {
      const updated: Record<string, ProposalIndicator> = {};
      Object.entries(prev).forEach(([messageId, indicator]) => {
        if (indicator.state === 'success') {
          updated[messageId] = indicator;
        }
      });
      return updated;
    });
  }, []);

  const setPending = useCallback(
    (messageId: string, count?: number, violations?: number) => {
      if (!pendingTimestampRef.current[messageId]) {
        pendingTimestampRef.current[messageId] = Date.now();
      }

      if (progressTimeoutsRef.current[messageId]) {
        progressTimeoutsRef.current[messageId]?.forEach((timeoutId) =>
          window.clearTimeout(timeoutId)
        );
      }
      progressTimeoutsRef.current[messageId] = [];
      eventProgressRef.current[messageId] = false;

      setProposalIndicators((prev) => {
        const previous = prev[messageId];
        const progress = previous?.progressCount ?? 0;
        const total = Math.max(1, count ?? previous?.count ?? (progress || 1));

        return {
          ...prev,
          [messageId]: {
            state: 'pending',
            count: total,
            progressCount: progress,
            stepStates: buildStepStates(total, progress),
            violations: violations ?? previous?.violations,
            errorMessage: previous?.errorMessage,
          },
        };
      });
    },
    []
  );

  const incrementProgress = useCallback(
    (messageId: string, amount: number, viaEvent = false) => {
      if (amount <= 0) return;

      if (viaEvent) {
        eventProgressRef.current[messageId] = true;
      }

      setProposalIndicators((prev) => {
        const indicator = prev[messageId];
        if (!indicator) return prev;

        const currentProgress = indicator.progressCount ?? 0;
        const total = Math.max(1, indicator.count ?? currentProgress + amount);
        const nextProgress = Math.min(total, currentProgress + amount);

        return {
          ...prev,
          [messageId]: {
            ...indicator,
            progressCount: nextProgress,
            count: total,
            stepStates: buildStepStates(total, nextProgress),
          },
        };
      });
    },
    []
  );

  const setError = useCallback((messageId: string, errorMessage: string) => {
    setProposalIndicators((prev) => ({
      ...prev,
      [messageId]: {
        state: 'error',
        errorMessage,
      },
    }));
  }, []);

  const convertEditsToSuggestions = useCallback(
    (edits: StringEdit[], messageId: string): EditSuggestion[] => {
      // Deduplicate per-edit to handle batches of different sizes
      // (e.g. individual edits during streaming vs all edits in the done event)
      const newEdits = edits.filter((e) => {
        const editKey = JSON.stringify({
          file_path: e.file_path,
          old_string: e.old_string,
          new_string: e.new_string,
        });
        if (processedEditsRef.current.has(editKey)) {
          return false;
        }
        processedEditsRef.current.add(editKey);
        return true;
      });

      if (newEdits.length === 0) {
        return [];
      }

      if (!progressTimeoutsRef.current[messageId]) {
        progressTimeoutsRef.current[messageId] = [];
      }

      const mapped: EditSuggestion[] = newEdits.map((edit, idx) => {
        editIdCounterRef.current += 1;

        const resolvedContent =
          projectFilesRef.current.find((f) => f.path === edit.file_path)
            ?.content ??
          (edit.file_path === currentFilePathRef.current
            ? fileContentRef.current
            : null);

        let line_start: number | undefined;
        if (resolvedContent && edit.old_string) {
          const charIdx = resolvedContent.indexOf(edit.old_string);
          if (charIdx !== -1) {
            line_start = resolvedContent.slice(0, charIdx).split('\n').length;
          }
        }

        return {
          ...edit,
          id: `${Date.now()}-${editIdCounterRef.current}-${idx}`,
          messageId,
          status: 'pending' as const,
          line_start,
        };
      });

      // Increment progress for each accepted edit chunk with a staggered cascade
      if (eventProgressRef.current[messageId]) {
        setProposalIndicators((prev) => {
          const current = prev[messageId];
          if (!current) return prev;
          const total = Math.max(current.count ?? mapped.length, mapped.length);
          const progress = Math.min(total, current.progressCount ?? 0);
          return {
            ...prev,
            [messageId]: {
              ...current,
              count: total,
              progressCount: progress,
              stepStates: buildStepStates(total, progress),
            },
          };
        });
      } else {
        mapped.forEach((_, idx) => {
          const timeoutId = window.setTimeout(() => {
            incrementProgress(messageId, 1);
          }, idx * STEP_CASCADE_DELAY_MS);
          progressTimeoutsRef.current[messageId]?.push(timeoutId);
        });
      }

      // Set success indicator with minimum display time
      if (mapped.length > 0) {
        const pendingStartTime = pendingTimestampRef.current[messageId];
        const totalCascadeDuration =
          Math.max(0, mapped.length - 1) * STEP_CASCADE_DELAY_MS;

        const finalizeIndicator = () => {
          setProposalIndicators((prev) => {
            const indicator = prev[messageId];
            const totalEdits =
              indicator?.count ?? indicator?.progressCount ?? mapped.length;
            return {
              ...prev,
              [messageId]: {
                state: 'success',
                count: totalEdits,
                progressCount: totalEdits,
                stepStates: buildStepStates(totalEdits, totalEdits),
              },
            };
          });
          delete pendingTimestampRef.current[messageId];
          progressTimeoutsRef.current[messageId]?.forEach((timeoutId) =>
            window.clearTimeout(timeoutId)
          );
          delete progressTimeoutsRef.current[messageId];
          delete eventProgressRef.current[messageId];
        };

        const scheduleSuccess = (delay: number) => {
          const timeoutId = window.setTimeout(finalizeIndicator, delay);
          progressTimeoutsRef.current[messageId]?.push(timeoutId);
        };

        if (pendingStartTime) {
          const elapsed = Date.now() - pendingStartTime;
          const remainingTime = Math.max(0, MIN_SUCCESS_DELAY_MS - elapsed);
          const delay =
            remainingTime + totalCascadeDuration + POST_CASCADE_BUFFER_MS;
          scheduleSuccess(delay);
        } else {
          const delay = totalCascadeDuration + POST_CASCADE_BUFFER_MS;
          scheduleSuccess(delay);
        }
      }

      return mapped;
    },
    [incrementProgress]
  );

  return {
    proposalIndicators,
    clearProposals,
    clearAllProposalsAndTimeouts,
    setPending,
    setError,
    incrementProgress,
    convertEditsToSuggestions,
  };
}
