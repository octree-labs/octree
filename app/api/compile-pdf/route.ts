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
import { createClient } from '@/lib/supabase/server';

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

      // Regenerate signed URL for cache hits (since signed URLs expire)
      let pdfUrl = cachedPayload.pdfUrl;
      if (cachedPayload.storagePath) {
        const supabase = await createClient();
        const { data: signedUrlData } = await supabase.storage
          .from('octree')
          .createSignedUrl(cachedPayload.storagePath, 3600);
        if (signedUrlData?.signedUrl) {
          pdfUrl = signedUrlData.signedUrl;
        }
      }

      return NextResponse.json({
        ...cachedPayload,
        pdfUrl,
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

    // Upload PDF to Supabase storage for large files (avoid content too large errors)
    const supabase = await createClient();
    const pdfFileName = `compiled_${compileResult.sha256 || Date.now()}.pdf`;
    const storagePath = body.projectId
      ? `projects/${body.projectId}/compiled/${pdfFileName}`
      : `compiled/${pdfFileName}`;

    const { error: uploadError } = await supabase.storage
      .from('octree')
      .upload(storagePath, compileResult.pdfBuffer, {
        contentType: 'application/pdf',
        upsert: true,
        cacheControl: '3600',
      });

    if (uploadError) {
      console.error('Failed to upload PDF to storage:', uploadError);
      return NextResponse.json(
        {
          error: 'Failed to store compiled PDF',
          details: uploadError.message,
        },
        { status: 500 }
      );
    }

    // Get a signed URL valid for 1 hour
    const { data: signedUrlData, error: signedUrlError } = await supabase.storage
      .from('octree')
      .createSignedUrl(storagePath, 3600);

    if (signedUrlError || !signedUrlData?.signedUrl) {
      console.error('Failed to create signed URL:', signedUrlError);
      return NextResponse.json(
        {
          error: 'Failed to generate PDF URL',
          details: signedUrlError?.message,
        },
        { status: 500 }
      );
    }

    const responsePayload: CompileCachePayload = {
      pdfUrl: signedUrlData.signedUrl,
      storagePath, // Store for regenerating signed URLs on cache hit
      size: compileResult.pdfBuffer.length,
      mimeType: 'application/pdf',
      debugInfo: {
        contentLength: compileResult.pdfBuffer.byteLength,
        requestId: compileResult.requestId,
        durationMs: compileResult.durationMs,
        queueMs: compileResult.queueMs,
        sha256: compileResult.sha256,
        storagePath,
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
