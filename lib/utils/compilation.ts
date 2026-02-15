import type { CompilationError } from '@/types/compilation';
import { isBinaryFile } from '@/lib/constants/file-types';
import { createClient } from '@/lib/supabase/client';

export function normalizePath(name: string): string {
  if (!name) return 'document.tex';
  return name.includes('.') ? name : `${name}.tex`;
}

export function summarizeLog(log?: string): string | undefined {
  if (!log) return undefined;
  const lines = log.split('\n').filter((line) => line.trim().length > 0);
  const lastLines = lines.slice(-5);
  return lastLines.join('\n');
}

export function createCompilationError(
  data: any,
  errorMessage: string
): CompilationError {
  return {
    message: errorMessage,
    details: data?.details,
    log: data?.log,
    stdout: data?.stdout,
    stderr: data?.stderr,
    code: data?.code,
    requestId: data?.requestId,
    queueMs: data?.queueMs,
    durationMs: data?.durationMs,
    summary: summarizeLog(data?.log || data?.stderr || data?.stdout),
    pdf: data?.pdf, // Include partial PDF if available despite error
  };
}

export async function processFileContent(
  fileBlob: Blob,
  fileName: string
): Promise<{ path: string; content: string; encoding?: string }> {
  const isBinary = isBinaryFile(fileName);
  let content: string;

  if (isBinary) {
    const arrayBuffer = await fileBlob.arrayBuffer();
    const uint8Array = new Uint8Array(arrayBuffer);
    // Convert to base64 in chunks to avoid stack overflow with large files
    let binary = '';
    const chunkSize = 32768;
    for (let i = 0; i < uint8Array.length; i += chunkSize) {
      const chunk = uint8Array.subarray(i, i + chunkSize);
      binary += String.fromCharCode.apply(null, chunk as unknown as number[]);
    }
    content = btoa(binary);
  } else {
    content = await fileBlob.text();
  }

  const fileEntry: {
    path: string;
    content: string;
    encoding?: string;
  } = {
    path: fileName,
    content: content,
  };

  if (isBinary) {
    fileEntry.encoding = 'base64';
  }

  return fileEntry;
}

const COMPILE_SERVICE_URL = process.env.NEXT_PUBLIC_COMPILE_SERVICE_URL;
const COMPILE_TIMEOUT_MS = 180_000;

export async function makeCompilationRequest(
  filesPayload: Array<{ path: string; content: string; encoding?: string }>,
  normalizedFileName: string,
  projectId?: string
): Promise<{ response: Response; data: any }> {
  if (!COMPILE_SERVICE_URL) {
    throw new Error('NEXT_PUBLIC_COMPILE_SERVICE_URL is not configured');
  }

  const requestBody = {
    files: filesPayload,
    projectId,
    lastModifiedFile: normalizedFileName,
  };

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), COMPILE_TIMEOUT_MS);

  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    // Attach Supabase JWT for compile service auth
    const supabase = createClient();
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.access_token) {
      headers['Authorization'] = `Bearer ${session.access_token}`;
    }

    const response = await fetch(`${COMPILE_SERVICE_URL}/compile`, {
      method: 'POST',
      headers,
      body: JSON.stringify(requestBody),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    // Extract debug info from headers
    const requestId = response.headers.get('x-compile-request-id') || null;
    const durationMs = response.headers.get('x-compile-duration-ms');
    const queueMs = response.headers.get('x-compile-queue-ms');
    const sha256 = response.headers.get('x-compile-sha256');

    if (!response.ok) {
      // Error response - parse JSON
      const errorText = await response.text();
      let errorData;
      try {
        errorData = JSON.parse(errorText);
      } catch {
        errorData = { error: errorText };
      }

      return {
        response,
        data: {
          error: errorData.error || 'LaTeX compilation failed',
          details: errorData.message || errorData.details,
          log: errorData.log,
          stdout: errorData.stdout,
          stderr: errorData.stderr,
          requestId,
          queueMs: queueMs ? Number(queueMs) : errorData.queueMs,
          durationMs: durationMs ? Number(durationMs) : errorData.durationMs,
          pdf: errorData.pdfBuffer, // Partial PDF if available
        },
      };
    }

    // Success - response is PDF binary
    const pdfArrayBuffer = await response.arrayBuffer();

    if (pdfArrayBuffer.byteLength === 0) {
      return {
        response,
        data: { error: 'Compilation returned empty response' },
      };
    }

    // Convert PDF to base64
    const uint8Array = new Uint8Array(pdfArrayBuffer);
    let binary = '';
    const chunkSize = 32768;
    for (let i = 0; i < uint8Array.length; i += chunkSize) {
      const chunk = uint8Array.subarray(i, i + chunkSize);
      binary += String.fromCharCode.apply(null, chunk as unknown as number[]);
    }
    const base64PDF = btoa(binary);

    return {
      response,
      data: {
        pdf: base64PDF,
        size: pdfArrayBuffer.byteLength,
        mimeType: 'application/pdf',
        debugInfo: {
          contentLength: pdfArrayBuffer.byteLength,
          base64Length: base64PDF.length,
          requestId,
          durationMs: durationMs ? Number(durationMs) : null,
          queueMs: queueMs ? Number(queueMs) : null,
          sha256,
        },
      },
    };
  } catch (error) {
    clearTimeout(timeoutId);

    if (error instanceof Error && error.name === 'AbortError') {
      return {
        response: new Response(null, { status: 408 }),
        data: {
          error: 'LaTeX compilation timed out',
          details: `Request took longer than ${COMPILE_TIMEOUT_MS / 1000} seconds`,
          suggestion: 'Try simplifying your LaTeX document',
        },
      };
    }

    throw error;
  }
}
