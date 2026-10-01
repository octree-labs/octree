'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { createResumeProject } from '@/actions/create-resume-project';
import { compileResumeTex, discardResumeUpload } from '@/lib/requests/resume';
import {
  ResumeRedesignActions,
  usePendingRedesign,
  type PendingRedesign,
} from '@/stores/resume-redesign';
import type { ResumeSuggestion } from '@/types/resume';

const applySuggestion = (tex: string, s: ResumeSuggestion) =>
  tex.replace(s.find, () => s.replace);
import { ResumeReview, type SuggestionStatus } from './resume-review';

export function ResumeReviewScreen() {
  const router = useRouter();
  const pending = usePendingRedesign();

  // Nothing to review on arrival (direct visit or refresh): the flow starts on
  // the dashboard. Checked once, so clearing the store on exit doesn't redirect.
  useEffect(() => {
    if (!ResumeRedesignActions.get()) router.replace('/');
  }, [router]);

  if (!pending) return null;
  return <ReviewWithResult key={pending.storagePath} pending={pending} />;
}

function ReviewWithResult({ pending }: { pending: PendingRedesign }) {
  const router = useRouter();
  const { fileName, storagePath, result } = pending;

  const [pdfData, setPdfData] = useState(result.pdf);
  const [tex, setTex] = useState(result.tex);
  const [statuses, setStatuses] = useState<Record<string, SuggestionStatus>>(() =>
    Object.fromEntries(result.suggestions.map((s) => [s.id, 'pending']))
  );
  const [isRecompiling, setIsRecompiling] = useState(false);
  const [isOpening, setIsOpening] = useState(false);

  const recompile = async (nextTex: string, applied: ResumeSuggestion[]) => {
    setIsRecompiling(true);
    try {
      const pdf = await compileResumeTex(nextTex);
      setTex(nextTex);
      setPdfData(pdf);
      setStatuses((prev) => ({
        ...prev,
        ...Object.fromEntries(applied.map((s) => [s.id, 'applied'])),
      }));
    } catch (err) {
      toast.error('Could not apply that fix', {
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setIsRecompiling(false);
    }
  };

  const markDismissed = (ids: string[]) =>
    setStatuses((prev) => ({
      ...prev,
      ...Object.fromEntries(ids.map((id) => [id, 'dismissed'])),
    }));

  const handleApply = (suggestion: ResumeSuggestion) => {
    if (!tex.includes(suggestion.find)) {
      toast.error('This fix no longer applies after your other changes.');
      markDismissed([suggestion.id]);
      return;
    }
    recompile(applySuggestion(tex, suggestion), [suggestion]);
  };

  const handleApplyAll = () => {
    let nextTex = tex;
    const applied: ResumeSuggestion[] = [];
    const skipped: string[] = [];
    for (const s of result.suggestions) {
      if (statuses[s.id] !== 'pending') continue;
      if (nextTex.includes(s.find)) {
        nextTex = applySuggestion(nextTex, s);
        applied.push(s);
      } else {
        skipped.push(s.id);
      }
    }
    if (skipped.length) markDismissed(skipped);
    if (applied.length) recompile(nextTex, applied);
  };

  const handleDiscard = () => {
    discardResumeUpload(storagePath).catch(() => {});
    router.push('/');
    ResumeRedesignActions.clear();
  };

  const handleOpenInEditor = async () => {
    setIsOpening(true);
    const title = `${fileName.replace(/\.pdf$/i, '')} (redesigned)`;
    const { projectId, error } = await createResumeProject(title, tex, storagePath);
    if (!projectId) {
      toast.error(error || 'Failed to create the project');
      setIsOpening(false);
      return;
    }
    router.push(`/projects/${projectId}?tab=ai`);
    ResumeRedesignActions.clear();
  };

  return (
    <ResumeReview
      pdfData={pdfData}
      coverage={result.coverage}
      suggestions={result.suggestions}
      statuses={statuses}
      isRecompiling={isRecompiling}
      isOpening={isOpening}
      onApply={handleApply}
      onApplyAll={handleApplyAll}
      onDismiss={(s) => markDismissed([s.id])}
      onDiscard={handleDiscard}
      onOpenInEditor={handleOpenInEditor}
    />
  );
}
