import { NextResponse } from 'next/server';
import type { CompileRequest, CompileCachePayload } from './types';
import {
  buildCacheKey,
  getCachedResponse,
  storeCachedResponse,
  getCacheStats,
} from './cache';
import { validateCompileRequest } from './validation';
import { compileLatex } from './compiler';

export const runtime = 'nodejs';
export const config = {
  api: {
    bodyParser: {
      sizeLimit: '25mb',
    },
  },
};

const COMPILE_SERVICE_URL =
  process.env.NODE_ENV === 'development'
    ? process.env.COMPILE_SERVICE_URL_STAGING
    : process.env.COMPILE_SERVICE_URL;

function normalizeRequest(body: Partial<CompileRequest>): CompileRequest {
  if (body.files && body.files.length > 0) {
    return {
      files: body.files,
      projectId: body.projectId,
      lastModifiedFile: body.lastModifiedFile,
    };
  }

  if (typeof body.content === 'string') {
    const path = body.lastModifiedFile || 'main.tex';
    return {
      files: [
        {
          path,
          content: body.content,
        },
      ],
      projectId: body.projectId,
      lastModifiedFile: path,
    };
  }

  throw new Error('Invalid compile request');
}

export async function POST(request: Request) {
  try {
    const rawBody: Partial<CompileRequest> = await request.json();

    const requestValidationError = validateCompileRequest(rawBody);
    if (requestValidationError) {
      return NextResponse.json(requestValidationError, { status: 400 });
    }

    const body = normalizeRequest(rawBody);

    const cacheKey = buildCacheKey(body);
    console.log(
      '[COMPILE CACHE] Cache key generated:',
      cacheKey?.substring(0, 16) + '...'
    );

    const cachedPayload = getCachedResponse(cacheKey);
    if (cachedPayload) {
      console.log(
        '🎯 [COMPILE CACHE] ⚡ CACHE HIT - Serving from cache instantly!',
        {
          cacheKey: cacheKey?.substring(0, 16) + '...',
          pdfSize: cachedPayload.size,
          projectId: body.projectId,
        }
      );
      return NextResponse.json({
        ...cachedPayload,
        debugInfo: {
          ...(cachedPayload.debugInfo ?? {}),
          cacheStatus: 'hit',
          cacheKey,
        },
      });
    }

    console.log('[COMPILE CACHE] CACHE MISS - Compiling with octree-compile', {
      cacheKey: cacheKey?.substring(0, 16) + '...',
      projectId: body.projectId,
      filesCount: body.files.length,
    });

    const compileResult = await compileLatex(
      body,
      COMPILE_SERVICE_URL as string
    );

    if (
      !compileResult.success ||
      !compileResult.base64PDF ||
      !compileResult.pdfBuffer
    ) {
      // Include partial PDF in error response if available from octree-compile
      const errorResponse: Record<string, unknown> = {
        ...compileResult.error,
        suggestion:
          compileResult.error?.suggestion ||
          'Check your LaTeX syntax and try again',
      };

      // If a partial PDF was generated despite the error, include it
      if (compileResult.error?.pdfBuffer) {
        errorResponse.pdf = compileResult.error.pdfBuffer;
      }

      return NextResponse.json(errorResponse, { status: 500 });
    }

    const responsePayload: CompileCachePayload = {
      pdf: compileResult.base64PDF,
      size: compileResult.pdfBuffer.length,
      mimeType: 'application/pdf',
      debugInfo: {
        contentLength: compileResult.pdfBuffer.byteLength,
        base64Length: compileResult.base64PDF.length,
        requestId: compileResult.requestId,
        durationMs: compileResult.durationMs,
        queueMs: compileResult.queueMs,
        sha256: compileResult.sha256,
      },
    };

    storeCachedResponse(cacheKey, responsePayload);
    const stats = getCacheStats();
    console.log('💾 [COMPILE CACHE] Stored in cache', {
      cacheKey: cacheKey?.substring(0, 16) + '...',
      pdfSize: compileResult.pdfBuffer.length,
      ttlMs: stats.ttlMs,
      cacheSize: stats.size,
      maxSize: stats.maxSize,
    });

    return NextResponse.json({
      ...responsePayload,
      debugInfo: {
        ...(responsePayload.debugInfo ?? {}),
        cacheStatus: 'miss',
        cacheKey,
      },
    });
  } catch (error) {
    console.error('LaTeX compilation error:', error);
    return NextResponse.json(
      {
        error: 'LaTeX compilation failed',
        details: String(error),
        suggestion: 'Check your LaTeX syntax and try again',
      },
      { status: 500 }
    );
  }
}
