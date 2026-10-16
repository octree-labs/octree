'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { TriangleAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DEFAULT_RESUME_TEMPLATE_ID,
  RESUME_TEMPLATE_OPTIONS,
} from '@/lib/resume/template-options';
import {
  discardResumeUpload,
  redesignResume,
  uploadResumePdf,
} from '@/lib/requests/resume';
import { ResumeRedesignActions } from '@/stores/resume-redesign';
import type { RedesignProgressEvent } from '@/types/resume';
import { RedesignProgress } from './redesign-progress';
import { ResumeDropzone } from './resume-dropzone';
import { TemplatePicker } from './template-picker';

type Phase = 'template' | 'upload' | 'running' | 'error';

export function ResumeRedesignDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>('template');
  const [templateId, setTemplateId] = useState(DEFAULT_RESUME_TEMPLATE_ID);
  const [file, setFile] = useState<File | null>(null);
  const [progress, setProgress] = useState<RedesignProgressEvent | null>(null);
  const [error, setError] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const storagePathRef = useRef<string | null>(null);
  useEffect(() => () => abortRef.current?.abort(), []);

  // Cancels any run and discards its upload; doesn't touch what's on screen.
  const cancelRun = () => {
    abortRef.current?.abort();
    if (storagePathRef.current) {
      discardResumeUpload(storagePathRef.current).catch(() => {});
      storagePathRef.current = null;
    }
  };

  // Back to a given step, cancelling any run and discarding its upload.
  const reset = (to: Phase = 'template') => {
    cancelRun();
    setPhase(to);
    setFile(null);
    setProgress(null);
    setError(null);
  };

  const run = async (nextFile: File) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setFile(nextFile);
    setError(null);
    setProgress(null);
    setPhase('running');

    try {
      const storagePath = await uploadResumePdf(nextFile);
      storagePathRef.current = storagePath;
      const result = await redesignResume(
        storagePath,
        templateId,
        setProgress,
        controller.signal
      );
      if (controller.signal.aborted) return;

      // The review page owns the upload from here on, so closing must not delete it.
      storagePathRef.current = null;
      ResumeRedesignActions.set({ fileName: nextFile.name, storagePath, result });
      router.push('/resume');
      handleOpenChange(false);
    } catch (err) {
      if (controller.signal.aborted) return;
      setError(err instanceof Error ? err.message : 'Something went wrong');
      setPhase('error');
    }
  };

  const selectedTemplate = RESUME_TEMPLATE_OPTIONS.find((t) => t.id === templateId);

  // Only cancel on close; the visible step resets after the exit animation
  // (onCloseAutoFocus), otherwise the closing dialog flashes the first step.
  const handleOpenChange = (next: boolean) => {
    if (!next) cancelRun();
    onOpenChange(next);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        // Fixed size across steps so the dialog doesn't jump between them.
        className="flex h-[min(560px,90vh)] flex-col sm:max-w-5xl sm:px-10"
        // Don't lose a running redesign to a stray click; the X still cancels it.
        onInteractOutside={(e) => phase === 'running' && e.preventDefault()}
        onCloseAutoFocus={() => {
          reset();
          setTemplateId(DEFAULT_RESUME_TEMPLATE_ID);
        }}
      >
        <DialogHeader>
          <DialogTitle>
            {phase === 'running' ? 'Redesigning your resume' : 'Redesign your resume'}
          </DialogTitle>
          {phase === 'running' && (
            <DialogDescription className="truncate">{file?.name}</DialogDescription>
          )}
          {phase === 'template' && (
            <DialogDescription>
              Pick a template. We&apos;ll rebuild your resume in it, keeping every
              detail, and point out anything worth fixing.
            </DialogDescription>
          )}
          {phase === 'upload' && (
            <DialogDescription>Upload your current resume as a PDF.</DialogDescription>
          )}
        </DialogHeader>

        <div className="-m-1 flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-1">
          {phase === 'template' && (
            <>
              <TemplatePicker value={templateId} onChange={setTemplateId} />
              <div className="mt-auto flex justify-end">
                <Button size="sm" onClick={() => setPhase('upload')}>
                  Continue
                </Button>
              </div>
            </>
          )}

          {phase === 'upload' && selectedTemplate && (
            <>
              <div className="flex items-center justify-between gap-3 rounded-lg border px-3 py-1.5 text-sm">
                <p>
                  <span className="text-neutral-500">Template:</span>{' '}
                  <span className="font-medium text-neutral-900">{selectedTemplate.name}</span>
                </p>
                <Button size="xs" variant="outline" onClick={() => setPhase('template')}>
                  Change template
                </Button>
              </div>
              <ResumeDropzone onFile={run} className="flex-1" />
            </>
          )}

          {phase === 'running' && (
            <RedesignProgress progress={progress} template={selectedTemplate} />
          )}

          {phase === 'error' && (
            <div className="space-y-4">
              <div className="flex gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
                <TriangleAlert className="mt-0.5 size-4 shrink-0" />
                <p>{error}</p>
              </div>
              <div className="flex justify-end gap-2">
                <Button size="sm" variant="outline" onClick={() => reset('upload')}>
                  Choose another file
                </Button>
                {file && (
                  <Button size="sm" onClick={() => run(file)}>
                    Try again
                  </Button>
                )}
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
