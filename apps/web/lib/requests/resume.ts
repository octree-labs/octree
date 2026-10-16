import { createClient } from '@/lib/supabase/client';
import { makeCompilationRequest } from '@/lib/utils/compilation';
import { readStream } from '@/lib/utils/sse';
import type {
  RedesignProgressEvent,
  RedesignResultEvent,
} from '@/types/resume';

export const MAX_RESUME_BYTES = 10 * 1024 * 1024;

// Type and size are enforced by ResumeDropzone.
export async function uploadResumePdf(file: File): Promise<string> {
  const supabase = createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.user) {
    throw new Error('You need to be signed in to upload a resume.');
  }

  const tempId = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  const path = `temp-imports/${session.user.id}/${tempId}/resume.pdf`;

  // Upload straight to storage so large files never hit Vercel's body limit.
  const { error } = await supabase.storage.from('octree').upload(path, file, {
    contentType: 'application/pdf',
    upsert: false,
  });
  if (error) {
    throw new Error(`Failed to upload file: ${error.message}`);
  }
  return path;
}

export async function redesignResume(
  storagePath: string,
  templateId: string,
  onProgress: (event: RedesignProgressEvent) => void,
  signal?: AbortSignal
): Promise<RedesignResultEvent> {
  const response = await fetch('/api/resume/redesign', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ storagePath, templateId }),
    signal,
  });

  if (!response.ok || !response.body) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || 'Failed to start the redesign.');
  }

  let result: RedesignResultEvent | null = null;
  let errorMessage: string | null = null;
  await readStream(response.body.getReader(), (event, data) => {
    if (event === 'progress') onProgress(data as RedesignProgressEvent);
    if (event === 'result') result = data as RedesignResultEvent;
    if (event === 'error') errorMessage = String(data.message);
  });

  if (errorMessage) throw new Error(errorMessage);
  if (!result) throw new Error('The connection closed before the redesign finished.');
  return result;
}

export async function compileResumeTex(tex: string): Promise<string> {
  const { response, data } = await makeCompilationRequest(
    [{ path: 'main.tex', content: tex }],
    'main.tex'
  );
  if (!response.ok || !data.pdf) {
    throw new Error(data.details || data.error || 'Failed to compile the resume.');
  }
  return data.pdf;
}

export async function discardResumeUpload(storagePath: string): Promise<void> {
  const supabase = createClient();
  await supabase.storage.from('octree').remove([storagePath]);
}
