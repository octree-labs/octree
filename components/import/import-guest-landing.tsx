'use client';

import { useEffect, useRef, useState, type MouseEvent } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { CheckCircle2, FileText, Loader2 } from 'lucide-react';
import { GoogleOAuthButton } from '@/components/auth/google-oauth-button';
import { SignUpForm } from '@/components/auth/signup-form';
import { AnalyticsEvents, type ImportPreviewCta } from '@/lib/analytics/events';
import { track } from '@/lib/analytics/track';

const ImportPreviewPage = dynamic(() => import('@/components/import/import-preview-page'), {
  ssr: false,
  loading: () => <div className="aspect-[1/1.3] w-full animate-pulse bg-muted" />,
});

type PreviewStatus =
  | { state: 'loading' }
  | { state: 'ok'; pdf: Blob }
  | { state: 'failed'; reason: 'compile_failed' | 'unavailable' | 'too_large' | 'not_found'; lines: string[] };

interface ImportGuestLandingProps {
  draftId: string;
  title: string;
  /** Raw draft source slug (`tools:templates:x`), for analytics. */
  source: string;
  /** Badge text, e.g. `TikZ Generator`. */
  sourceLabel: string | null;
  /** Host the draft came from, e.g. `tools.useoctree.com`. */
  sourceSite: string | null;
  /** First lines of the LaTeX, shown under the PDF. */
  latexPreview: string;
  latexTruncated: boolean;
  nextPath: string;
}

export function previewUrl(draftId: string) {
  return `/api/import/preview/${encodeURIComponent(draftId)}`;
}

async function fetchPreview(draftId: string, signal: AbortSignal): Promise<PreviewStatus> {
  const res = await fetch(previewUrl(draftId), { signal, credentials: 'same-origin' });
  if (res.ok) {
    return { state: 'ok', pdf: await res.blob() };
  }
  let reason: Extract<PreviewStatus, { state: 'failed' }>['reason'] = 'unavailable';
  let lines: string[] = [];
  try {
    const body = (await res.json()) as { reason?: string; lines?: unknown };
    if (body.reason === 'compile_failed' || body.reason === 'too_large') reason = body.reason;
    if (Array.isArray(body.lines)) lines = body.lines.map(String).slice(0, 3);
  } catch {
    // Non-JSON error body: keep 'unavailable'.
  }
  if (res.status === 404) reason = 'not_found';
  return { state: 'failed', reason, lines };
}

/**
 * Logged-out body of /import/start: the compiled first page on the left,
 * the sign-up / log-in column on the right. The PDF comes from
 * /api/import/preview/<id> (a server compile, cached per draft); nothing
 * here needs a session, and the `next=` round trip into /import is the
 * same one the previous text-only landing used.
 */
export function ImportGuestLanding({
  draftId,
  title,
  source,
  sourceLabel,
  sourceSite,
  latexPreview,
  latexTruncated,
  nextPath,
}: ImportGuestLandingProps) {
  const [status, setStatus] = useState<PreviewStatus>({ state: 'loading' });
  const statusRef = useRef(status);
  statusRef.current = status;

  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;

    fetchPreview(draftId, controller.signal)
      .catch((): PreviewStatus => ({ state: 'failed', reason: 'unavailable', lines: [] }))
      .then((next) => {
        if (cancelled) return;
        setStatus(next);
        track(AnalyticsEvents.IMPORT_PREVIEW_SHOWN, {
          source,
          ok: next.state === 'ok',
          ...(next.state === 'failed' ? { reason: next.reason } : {}),
        });
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [draftId, source]);

  const handleCtaClick = (event: MouseEvent<HTMLElement>) => {
    // Only real controls count: typing in the email form is not a click-through.
    const control = (event.target as HTMLElement | null)?.closest<HTMLElement>('button, a');
    if (!control) return;
    const method: ImportPreviewCta | undefined =
      control.tagName === 'A'
        ? control.getAttribute('href')?.startsWith('/auth/login')
          ? 'login'
          : undefined
        : (control.closest<HTMLElement>('[data-import-cta]')?.dataset.importCta as
            | ImportPreviewCta
            | undefined);
    if (!method) return;
    const current = statusRef.current;
    track(AnalyticsEvents.IMPORT_PREVIEW_SIGNUP_CLICKED, {
      source,
      method,
      preview_ok: current.state === 'loading' ? null : current.state === 'ok',
    });
  };

  const headline =
    status.state === 'ok'
      ? 'Your document compiled. Sign up free to edit it with AI.'
      : status.state === 'loading'
        ? 'Compiling your document…'
        : 'Your LaTeX is saved. Sign up free to open it.';

  return (
    <main className="mx-auto grid w-full max-w-5xl flex-1 gap-10 px-6 pb-12 lg:grid-cols-[minmax(0,1fr)_380px]">
      <section className="min-w-0">
        <p className="text-sm text-muted-foreground">
          From {sourceSite ?? 'Octree'}
          {sourceLabel ? ` · ${sourceLabel}` : ''}
        </p>
        <h1 className="mt-2 break-words text-3xl font-semibold tracking-tight">
          Open <span className="text-primary">{title}</span> in Octree
        </h1>
        <p className="mt-3 flex items-center gap-2 text-muted-foreground" aria-live="polite">
          {status.state === 'loading' ? (
            <Loader2 className="h-4 w-4 shrink-0 animate-spin" aria-hidden />
          ) : status.state === 'ok' ? (
            <CheckCircle2 className="h-4 w-4 shrink-0 text-green-600" aria-hidden />
          ) : (
            <FileText className="h-4 w-4 shrink-0" aria-hidden />
          )}
          <span>{headline}</span>
        </p>

        <div className="mt-6 overflow-hidden rounded-lg border bg-muted/40">
          <div className="flex items-center justify-between border-b px-4 py-2 text-xs text-muted-foreground">
            <span className="font-mono">main.pdf</span>
            <span>{status.state === 'ok' ? 'Page 1' : 'Preview'}</span>
          </div>

          {status.state === 'ok' ? (
            <div className="relative max-h-[640px] overflow-hidden bg-neutral-200 p-3 dark:bg-neutral-800">
              <div className="mx-auto max-w-[620px] shadow-md">
                <ImportPreviewPage
                  pdf={status.pdf}
                  onError={() => setStatus({ state: 'failed', reason: 'unavailable', lines: [] })}
                />
              </div>
              <div className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-neutral-200 to-transparent dark:from-neutral-800" />
            </div>
          ) : status.state === 'loading' ? (
            <div className="p-3">
              <div className="mx-auto aspect-[1/1.3] max-w-[620px] animate-pulse rounded bg-muted" />
            </div>
          ) : (
            <div className="p-6">
              <p className="font-medium">Preview unavailable</p>
              <p className="mt-1 text-sm text-muted-foreground">
                {status.reason === 'compile_failed'
                  ? 'This document has a LaTeX error. Your source is saved; sign up to open it and fix it with AI.'
                  : status.reason === 'too_large'
                    ? 'This document is too large to preview here. Your source is saved; sign up to open it.'
                    : 'Your LaTeX is saved; sign up to open it.'}
              </p>
              {status.lines.length > 0 ? (
                <pre className="mt-3 overflow-auto rounded bg-background p-3 font-mono text-xs leading-relaxed text-destructive">
                  {status.lines.join('\n')}
                </pre>
              ) : null}
            </div>
          )}
        </div>

        <details className="mt-4 rounded-lg border bg-muted/40 text-sm">
          <summary className="cursor-pointer px-4 py-2 text-xs text-muted-foreground">
            <span className="font-mono">main.tex</span> · view LaTeX source
          </summary>
          <pre className="max-h-96 overflow-auto border-t p-4 font-mono text-xs leading-relaxed">
            {latexPreview}
            {latexTruncated ? '\n…' : ''}
          </pre>
        </details>
      </section>

      <aside className="flex flex-col gap-4" onClickCapture={handleCtaClick}>
        <div data-import-cta="google">
          <GoogleOAuthButton nextPath={nextPath} label="Continue with Google" />
        </div>

        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span className="h-px flex-1 bg-border" />
          or sign up with email
          <span className="h-px flex-1 bg-border" />
        </div>

        <div data-import-cta="email">
          <SignUpForm nextPath={nextPath} />
        </div>

        <p className="text-center text-sm text-muted-foreground">
          Already have an account?{' '}
          <Link
            href={`/auth/login?next=${encodeURIComponent(nextPath)}`}
            className="underline underline-offset-4"
            data-import-cta="login"
          >
            Log in
          </Link>
        </p>
      </aside>
    </main>
  );
}
