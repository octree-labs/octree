import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createSSEHeaders, createSSEStream } from '@/lib/octra-agent/stream-handling';
import { compileLatex } from '@/app/api/compile-pdf/compiler';
import { extractPdfText } from '@/lib/resume/extract-text';
import {
  extractLatexErrors,
  ResumeCompileError,
  runRedesign,
  type CompileFn,
} from '@/lib/resume/pipeline';
import { getResumeTemplate } from '@/lib/resume/templates';
import type { RedesignResultEvent } from '@/types/resume';

export const runtime = 'nodejs';
export const maxDuration = 300;

const COMPILE_SERVICE_URL = process.env.COMPILE_SERVICE_URL;
const MAX_PAGES = 5;

// Errors whose message is safe and useful to show the user.
class UserFacingError extends Error {}

export async function POST(request: Request) {
  const supabase = await createClient();
  const [
    {
      data: { user },
    },
    {
      data: { session },
    },
  ] = await Promise.all([supabase.auth.getUser(), supabase.auth.getSession()]);

  if (!user || !session?.access_token) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!COMPILE_SERVICE_URL) {
    return NextResponse.json(
      { error: 'Compile service is not configured' },
      { status: 500 }
    );
  }

  const { storagePath, templateId } = await request.json();
  if (
    typeof storagePath !== 'string' ||
    !storagePath.startsWith(`temp-imports/${user.id}/`)
  ) {
    return NextResponse.json({ error: 'Invalid storage path' }, { status: 403 });
  }

  let template;
  try {
    template = getResumeTemplate(templateId);
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 400 }
    );
  }

  const removeUpload = () =>
    supabase.storage
      .from('octree')
      .remove([storagePath])
      .catch((err) => console.error('Failed to clean up resume upload:', err));

  const compile: CompileFn = async (tex) => {
    const result = await compileLatex(
      { files: [{ path: 'main.tex', content: tex }] },
      COMPILE_SERVICE_URL,
      session.access_token
    );
    if (result.success && result.pdfBuffer) {
      return { ok: true, pdf: result.pdfBuffer };
    }
    const error = result.error;
    const log = error?.log || error?.stdout || '';
    return {
      ok: false,
      errors: log
        ? extractLatexErrors(log)
        : `${error?.error ?? 'Compilation failed'}: ${error?.details ?? ''}`,
    };
  };

  const { stream, writeEvent: send, cleanup } = createSSEStream();

  (async () => {
    try {
      send('progress', { step: 'reading' });
      const { data: file, error: downloadError } = await supabase.storage
        .from('octree')
        .download(storagePath);
      if (downloadError || !file) {
        throw new UserFacingError('Could not read the uploaded file. Please try again.');
      }

      const pdf = new Uint8Array(await file.arrayBuffer());
      const { text: sourceText, totalPages } = await extractPdfText(pdf);
      if (totalPages > MAX_PAGES) {
        throw new UserFacingError(
          `This PDF has ${totalPages} pages. Resumes up to ${MAX_PAGES} pages are supported.`
        );
      }
      if (!sourceText.trim()) {
        throw new UserFacingError(
          'This PDF has no selectable text (it may be a scanned image). Please upload a text-based PDF.'
        );
      }

      const result = await runRedesign({
        pdf,
        sourceText,
        template,
        compile,
        onProgress: (event) => send('progress', event),
      });

      const payload: RedesignResultEvent = {
        tex: result.tex,
        pdf: Buffer.from(result.pdf).toString('base64'),
        coverage: result.coverage,
        suggestions: result.suggestions,
      };
      send('result', payload);
    } catch (error) {
      console.error('Resume redesign failed:', error);
      await removeUpload();
      send('error', {
        message:
          error instanceof UserFacingError
            ? error.message
            : error instanceof ResumeCompileError
              ? 'We could not produce a PDF for this resume. Please try again.'
              : 'Something went wrong while redesigning your resume. Please try again.',
      });
    } finally {
      cleanup();
    }
  })();

  return new Response(stream, { headers: createSSEHeaders() });
}
