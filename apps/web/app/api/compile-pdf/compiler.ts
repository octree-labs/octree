import type { CompileRequest, CompilerResponse } from './types';

const COMPILE_TIMEOUT_MS = 180_000;

export async function compileLatex(
  body: CompileRequest,
  compileServiceUrl: string,
  sessionToken: string
): Promise<CompilerResponse> {
  const { files, projectId, lastModifiedFile } = body;

  const requestBody = JSON.stringify({
    files,
    projectId,
    lastModifiedFile,
  });
  const requestHeaders: Record<string, string> = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${sessionToken}`,
  };

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), COMPILE_TIMEOUT_MS);

    const response = await fetch(`${compileServiceUrl}/compile`, {
      method: 'POST',
      headers: requestHeaders,
      body: requestBody,
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      return await handleCompileError(response);
    }

    return await handleCompileSuccess(response);
  } catch (error) {
    return handleCompileException(error);
  }
}

/**
 * Handles successful compilation response
 */
async function handleCompileSuccess(
  response: Response
): Promise<CompilerResponse> {
  const requestId = response.headers.get('x-compile-request-id') || null;
  const durationMs = response.headers.get('x-compile-duration-ms');
  const queueMs = response.headers.get('x-compile-queue-ms');
  const sha256 = response.headers.get('x-compile-sha256');

  const pdfArrayBuffer = await response.arrayBuffer();

  // Check if we got a valid PDF
  if (pdfArrayBuffer.byteLength === 0) {
    throw new Error('octree-compile returned empty response');
  }

  // Verify PDF magic number (%PDF)
  const pdfBuffer = Buffer.from(pdfArrayBuffer);
  const firstBytes = pdfBuffer.toString('utf8', 0, 4);
  if (firstBytes !== '%PDF') {
    throw new Error(`Invalid PDF format. Expected %PDF, got: ${firstBytes}`);
  }

  // Convert to Base64
  const base64PDF = pdfBuffer.toString('base64');

  return {
    success: true,
    pdfBuffer,
    base64PDF,
    requestId,
    durationMs: durationMs ? Number(durationMs) : null,
    queueMs: queueMs ? Number(queueMs) : null,
    sha256,
  };
}

/**
 * Handles compilation error response
 */
async function handleCompileError(
  response: Response
): Promise<CompilerResponse> {
  const errorText = await response.text();

  // Parse octree-compile error response (always JSON on error)
  let errorData;
  try {
    errorData = JSON.parse(errorText);
  } catch {
    errorData = { error: errorText };
  }

  const requestId =
    response.headers.get('x-compile-request-id') || errorData.requestId || null;
  const durationMs = response.headers.get('x-compile-duration-ms');
  const queueMs = response.headers.get('x-compile-queue-ms');

  return {
    success: false,
    error: {
      error: errorData.error || 'LaTeX compilation failed',
      details:
        errorData.message ||
        errorData.details ||
        `Server returned status ${response.status}`,
      log: errorData.log,
      stdout: errorData.stdout,
      stderr: errorData.stderr,
      requestId,
      queueMs: queueMs ? Number(queueMs) : errorData.queueMs,
      durationMs: durationMs ? Number(durationMs) : errorData.durationMs,
      pdfBuffer: errorData.pdfBuffer, // Base64-encoded partial PDF if available
    },
  };
}

/**
 * Handles compilation exceptions
 */
function handleCompileException(error: unknown): CompilerResponse {
  if (error instanceof Error && error.name === 'AbortError') {
    return {
      success: false,
      error: {
        error: 'LaTeX compilation timed out',
        details: `Request took longer than ${COMPILE_TIMEOUT_MS / 1000} seconds`,
        suggestion:
          'Try simplifying your LaTeX document or contact support if the issue persists',
      },
    };
  }

  return {
    success: false,
    error: {
      error: 'LaTeX compilation failed',
      details: String(error),
      suggestion: 'The octree-compile service may be temporarily unavailable',
    },
  };
}
