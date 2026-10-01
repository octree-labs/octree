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

  // Back to a given step, cancelling any run and discarding its upload.
  const reset = (to: Phase = 'template') => {
    abortRef.current?.abort();
    if (storagePathRef.current) {
      discardResumeUpload(storagePathRef.current).catch(() => {});
      storagePathRef.current = null;
    }
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

      // The review page owns the upload from here on, so reset() must not delete it.
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

  const templateName = RESUME_TEMPLATE_OPTIONS.find((t) => t.id === templateId)?.name;

  const handleOpenChange = (next: boolean) => {
    if (!next) {
      reset();
      setTemplateId(DEFAULT_RESUME_TEMPLATE_ID);
    }
    onOpenChange(next);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className={phase === 'template' ? 'sm:max-w-[760px]' : 'sm:max-w-[560px]'}
        // Don't lose a running redesign to a stray click; the X still cancels it.
        onInteractOutside={(e) => phase === 'running' && e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>
            {phase === 'running' ? 'Redesigning your resume' : 'Redesign your resume'}
          </DialogTitle>
          {phase === 'template' && (
            <DialogDescription>
              Pick a template. We&apos;ll rebuild your resume in it, keeping every
              detail, and point out anything worth fixing.
            </DialogDescription>
          )}
          {phase === 'upload' && (
            <DialogDescription>
              Upload your current resume as a PDF.{' '}
              <span className="text-neutral-700">
                Template: {templateName}
              </span>{' '}
              ·{' '}
              <button
                type="button"
                onClick={() => setPhase('template')}
                className="text-primary hover:underline"
              >
                Change
              </button>
            </DialogDescription>
          )}
        </DialogHeader>

        {phase === 'template' && (
          <div className="space-y-4">
            <TemplatePicker value={templateId} onChange={setTemplateId} />
            <div className="flex justify-end">
              <Button size="sm" onClick={() => setPhase('upload')}>
                Continue
              </Button>
            </div>
          </div>
        )}

        {phase === 'upload' && <ResumeDropzone onFile={run} />}

        {phase === 'running' && (
          <RedesignProgress fileName={file?.name ?? ''} progress={progress} />
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
      </DialogContent>
    </Dialog>
  );
}
