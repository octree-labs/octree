export interface FileEntry {
  path: string;
  content: string;
  encoding?: string; // "base64" for binary files
}

export interface CompileRequest {
  files: FileEntry[];
  projectId?: string; // Project identifier for caching
  lastModifiedFile?: string; // Hint for which file changed
  // Legacy single-file support
  content?: string;
}

export type CompileCachePayload = {
  pdf: string;
  size: number;
  mimeType: string;
  debugInfo?: Record<string, unknown>;
};

export interface CompileCacheEntry {
  payload: CompileCachePayload;
  timestamp: number;
}

export interface CompilerResponse {
  success: boolean;
  pdfBuffer?: Buffer;
  base64PDF?: string;
  requestId?: string | null;
  durationMs?: number | null;
  queueMs?: number | null;
  sha256?: string | null;
  error?: {
    error: string;
    details: string;
    suggestion?: string;
    log?: string;
    stdout?: string;
    stderr?: string;
    requestId?: string | null;
    queueMs?: number | null;
    durationMs?: number | null;
    pdfBuffer?: string; // Base64-encoded partial PDF if available
  };
}

