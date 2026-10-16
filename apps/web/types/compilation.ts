export interface CompilationError {
  message: string;
  details?: string;
  log?: string;
  stdout?: string;
  stderr?: string;
  code?: number;
  requestId?: string | null;
  queueMs?: number | null;
  durationMs?: number | null;
  summary?: string;
  pdf?: string; // Base64-encoded partial PDF if available despite error
}

