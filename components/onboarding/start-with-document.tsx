'use client';

import { useCallback, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useDropzone, type FileRejection } from 'react-dropzone';
import { BookOpen, ClipboardPaste, FilePlus2, FileUp, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

import { createProjectFromLatex } from '@/actions/create-project-from-latex';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { useCreateProject } from '@/hooks/create-project-client';
import { AnalyticsEvents, type StartOptionContext } from '@/lib/analytics/events';
import { track } from '@/lib/analytics/track';
import { SAMPLE_ARTICLE_TEX, SAMPLE_ARTICLE_TITLE } from '@/lib/onboarding/sample-article';
import {
  BLANK_PROJECT_TITLE,
  MAX_LATEX_BYTES,
  START_OPTIONS,
  type StartChoice,
  type StartOption,
  isLatexTooLarge,
  projectPayloadFromPaste,
  projectPayloadFromTexUpload,
  projectSourceForOption,
  uploadKind,
} from '@/lib/onboarding/start-options';
import { importProject } from '@/lib/requests/project';
import { cn } from '@/lib/utils';

const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;
const MAX_LATEX_MB = Math.round(MAX_LATEX_BYTES / (1024 * 1024));
const TEX_TOO_LARGE = `That .tex file is over ${MAX_LATEX_MB} MB. Zip it and upload the ZIP instead.`;
const PASTE_TOO_LARGE = `That is over ${MAX_LATEX_MB} MB of LaTeX. Save it as a .tex, zip it and upload the ZIP instead.`;

const OPTION_COPY: Record<
  StartOption,
  { title: string; description: string; icon: React.ComponentType<{ className?: string }> }
> = {
  upload: {
    title: 'Upload .tex or .zip',
    description: 'An Overleaf export (Download → Source) works as-is.',
    icon: FileUp,
  },
  paste: {
    title: 'Paste LaTeX',
    description: 'Drop in a document or a fragment; it becomes main.tex.',
    icon: ClipboardPaste,
  },
  sample: {
    title: 'Start from a sample',
    description: 'A short article with equations and a table to try AI edits on.',
    icon: BookOpen,
  },
  blank: {
    title: 'Blank project',
    description: 'An empty article template to write from scratch.',
    icon: FilePlus2,
  },
};

interface StartWithDocumentProps {
  /** Where the screen is shown; reported with every option event. */
  context: StartOptionContext;
  /** Shown as "I'll do this later" when given (the onboarding step is skippable). */
  onSkip?: () => void;
  /**
   * `data-onboarding-target` values for the dashboard walkthrough, so its
   * spotlight still finds "new project" and "generate" on the empty dashboard.
   */
  targets?: { blank?: string; generate?: string };
  className?: string;
}

/**
 * The four "bring your document" options, in the same order on the final
 * onboarding step and the empty dashboard. Each one creates a project through
 * the existing server action / import API and lands in the editor, which opens
 * main.tex and compiles on mount, so the first session ends with the user's
 * own LaTeX rendered. "Generate with AI" is deliberately a text link.
 */
export function StartWithDocument({ context, onSkip, targets, className }: StartWithDocumentProps) {
  const router = useRouter();
  const { createProjectWithRefresh, refreshProjects } = useCreateProject();
  const [busy, setBusy] = useState<StartOption | null>(null);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasted, setPasted] = useState('');

  const select = useCallback(
    (option: StartChoice) => {
      track(AnalyticsEvents.ONBOARDING_START_OPTION_SELECTED, { option, context });
    },
    [context]
  );

  const openProject = useCallback(
    (option: StartOption, projectId: string) => {
      track(AnalyticsEvents.PROJECT_CREATED, { source: projectSourceForOption(option) });
      refreshProjects();
      router.push(`/projects/${projectId}`);
    },
    [refreshProjects, router]
  );

  const createFromLatex = useCallback(
    async (option: StartOption, title: string, content: string) => {
      setBusy(option);
      try {
        const result = await createProjectFromLatex(title, content);
        if (!result.projectId) {
          toast.error(result.error || 'Failed to create project');
          setBusy(null);
          return;
        }
        openProject(option, result.projectId);
      } catch (error) {
        console.error('Failed to create project:', error);
        toast.error('Failed to create project. Please try again.');
        setBusy(null);
      }
    },
    [openProject]
  );

  const handleUpload = useCallback(
    async (file: File) => {
      const kind = uploadKind(file.name);
      if (!kind) {
        toast.error('Please choose a .tex or .zip file');
        return;
      }
      if (kind === 'tex') {
        if (file.size > MAX_LATEX_BYTES) {
          toast.error(TEX_TOO_LARGE);
          return;
        }
        const payload = projectPayloadFromTexUpload(file.name, await file.text());
        if (!payload) {
          toast.error('That .tex file is empty');
          return;
        }
        if (isLatexTooLarge(payload.content)) {
          toast.error(TEX_TOO_LARGE);
          return;
        }
        await createFromLatex('upload', payload.title, payload.content);
        return;
      }

      setBusy('upload');
      try {
        const data = await importProject(file);
        if (!data.success || !data.projectId) {
          toast.error(data.error || 'Failed to import project');
          setBusy(null);
          return;
        }
        openProject('upload', data.projectId);
      } catch (error) {
        console.error('Failed to import project:', error);
        toast.error('Failed to import project. Please check your ZIP file.');
        setBusy(null);
      }
    },
    [createFromLatex, openProject]
  );

  const onDrop = useCallback(
    (accepted: File[], rejected: FileRejection[]) => {
      if (rejected.length > 0) {
        const code = rejected[0].errors[0]?.code;
        toast.error(
          code === 'file-too-large'
            ? 'File size must be less than 50MB'
            : 'Please choose a .tex or .zip file'
        );
        return;
      }
      if (accepted[0]) void handleUpload(accepted[0]);
    },
    [handleUpload]
  );

  const { getRootProps, getInputProps, isDragActive, open: openFilePicker } = useDropzone({
    onDrop,
    // Browsers report .tex with one of these MIME types or none at all;
    // react-dropzone also matches on the extensions, so no text/plain, which
    // would let the picker offer every .txt.
    accept: {
      'application/zip': ['.zip'],
      'application/x-zip-compressed': ['.zip'],
      'application/x-tex': ['.tex'],
      'text/x-tex': ['.tex'],
    },
    maxSize: MAX_UPLOAD_BYTES,
    multiple: false,
    noClick: true,
    noKeyboard: true,
    disabled: busy !== null,
  });

  const handleOption = (option: StartOption) => {
    if (busy) return;
    select(option);
    switch (option) {
      case 'upload':
        openFilePicker();
        return;
      case 'paste':
        setPasteOpen(true);
        return;
      case 'sample':
        void createFromLatex('sample', SAMPLE_ARTICLE_TITLE, SAMPLE_ARTICLE_TEX);
        return;
      case 'blank':
        void (async () => {
          setBusy('blank');
          const result = await createProjectWithRefresh(BLANK_PROJECT_TITLE, 'blank');
          if (result.success && result.projectId) {
            router.push(`/projects/${result.projectId}`);
          } else {
            toast.error(result.message || 'Failed to create project');
            setBusy(null);
          }
        })();
        return;
    }
  };

  const handlePasteSubmit = () => {
    const payload = projectPayloadFromPaste(pasted);
    if (!payload) {
      toast.error('Paste some LaTeX first');
      return;
    }
    if (isLatexTooLarge(payload.content)) {
      toast.error(PASTE_TOO_LARGE);
      return;
    }
    void createFromLatex('paste', payload.title, payload.content);
  };

  return (
    <div className={cn('space-y-4', className)}>
      <div className="grid gap-3 sm:grid-cols-2">
        {START_OPTIONS.map((option) => {
          const copy = OPTION_COPY[option];
          const Icon = copy.icon;
          const isBusy = busy === option;
          const isUpload = option === 'upload';
          const dropzoneProps = isUpload ? getRootProps() : {};
          return (
            <div
              key={option}
              {...dropzoneProps}
              data-onboarding-target={option === 'blank' ? targets?.blank : undefined}
              className={cn('h-full', isUpload && 'rounded-lg', isDragActive && isUpload && 'ring-2 ring-primary')}
            >
              {isUpload && <input {...getInputProps()} />}
              <button
                type="button"
                onClick={() => handleOption(option)}
                disabled={busy !== null}
                aria-busy={isBusy}
                className={cn(
                  'flex h-full w-full flex-col items-start gap-3 rounded-lg border bg-card p-4 text-left transition-all',
                  'hover:border-primary/60 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
                  'disabled:cursor-not-allowed disabled:opacity-60',
                  option === 'upload' ? 'border-primary/40 bg-primary/5' : 'border-neutral-300',
                  pasteOpen && option === 'paste' && 'border-primary'
                )}
              >
                <span className="flex size-9 items-center justify-center rounded-md bg-primary/10 text-primary">
                  {isBusy ? <Loader2 className="size-5 animate-spin" /> : <Icon className="size-5" />}
                </span>
                <span className="space-y-1">
                  <span className="block text-sm font-semibold text-neutral-900">{copy.title}</span>
                  <span className="block text-xs leading-relaxed text-neutral-500">
                    {copy.description}
                  </span>
                </span>
              </button>
            </div>
          );
        })}
      </div>

      {pasteOpen && (
        <div className="space-y-2 rounded-lg border border-neutral-300 bg-card p-3">
          <Textarea
            value={pasted}
            onChange={(e) => setPasted(e.target.value)}
            placeholder={'\\documentclass{article}\n\\begin{document}\n...\n\\end{document}'}
            spellCheck={false}
            className="min-h-40 font-mono text-xs"
            disabled={busy !== null}
            autoFocus
          />
          <p className="text-xs text-muted-foreground">
            A fragment without <code>\documentclass</code> is wrapped in an article preamble.
          </p>
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setPasteOpen(false)}
              disabled={busy !== null}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="gradient"
              size="sm"
              onClick={handlePasteSubmit}
              disabled={busy !== null || !pasted.trim()}
            >
              {busy === 'paste' ? 'Creating...' : 'Create project'}
            </Button>
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 text-xs text-muted-foreground">
        <span data-onboarding-target={targets?.generate}>
          Nothing to bring?{' '}
          <Link
            href={`/generate?from=${context}`}
            onClick={() => select('generate')}
            className="font-medium text-primary underline-offset-4 hover:underline"
          >
            Generate a document with AI
          </Link>
        </span>
        {onSkip && (
          <button
            type="button"
            onClick={() => {
              select('later');
              onSkip();
            }}
            disabled={busy !== null}
            className="underline-offset-4 hover:text-foreground hover:underline disabled:opacity-60"
          >
            I&apos;ll do this later
          </button>
        )}
      </div>
    </div>
  );
}
