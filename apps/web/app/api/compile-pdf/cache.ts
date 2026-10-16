import { createHash } from 'crypto';
import type { CompileRequest, CompileCachePayload, CompileCacheEntry } from './types';

const CACHE_TTL_MS = Number(process.env.COMPILE_CACHE_TTL_MS ?? 60_000);
const MAX_CACHE_ENTRIES = Number(process.env.COMPILE_CACHE_MAX_ENTRIES ?? 32);

// Global cache instance
const globalForCompileCache = globalThis as unknown as {
  __octreeCompileCache__?: Map<string, CompileCacheEntry>;
};

const compileCache =
  globalForCompileCache.__octreeCompileCache__ ??
  (globalForCompileCache.__octreeCompileCache__ = new Map<string, CompileCacheEntry>());

/**
 * Builds a cache key from the compile request
 */
export function buildCacheKey(body: CompileRequest): string | null {
  if (body.files && body.files.length > 0) {
    const hash = createHash('sha256');
    const sortedFiles = [...body.files].sort((a, b) => a.path.localeCompare(b.path));
    for (const file of sortedFiles) {
      hash.update(file.path);
      hash.update('\0');
      hash.update(file.content);
      if (file.encoding) {
        hash.update('\0');
        hash.update(file.encoding);
      }
    }
    if (body.projectId) {
      hash.update('\0');
      hash.update(`project:${body.projectId}`);
    }
    return hash.digest('hex');
  }

  if (body.content) {
    const hash = createHash('sha256');
    hash.update(body.content);
    if (body.projectId) {
      hash.update('\0');
      hash.update(`project:${body.projectId}`);
    }
    return hash.digest('hex');
  }

  return null;
}

/**
 * Retrieves a cached response if available and not expired
 */
export function getCachedResponse(cacheKey: string | null): CompileCachePayload | null {
  if (!cacheKey) {
    return null;
  }

  const entry = compileCache.get(cacheKey);
  if (!entry) {
    return null;
  }

  const age = Date.now() - entry.timestamp;
  if (age > CACHE_TTL_MS) {
    console.log('⏰ [COMPILE CACHE] Cache entry expired', {
      cacheKey: cacheKey.substring(0, 16) + '...',
      ageMs: age,
      ttlMs: CACHE_TTL_MS,
    });
    compileCache.delete(cacheKey);
    return null;
  }

  return entry.payload;
}

/**
 * Stores a response in the cache
 */
export function storeCachedResponse(cacheKey: string | null, payload: CompileCachePayload): void {
  if (!cacheKey) {
    return;
  }

  // Evict oldest entry if cache is full
  if (compileCache.size >= MAX_CACHE_ENTRIES) {
    const oldestKey = compileCache.keys().next().value as string | undefined;
    if (oldestKey) {
      console.log('🗑️ [COMPILE CACHE] Evicting oldest entry (cache full)', {
        evictedKey: oldestKey.substring(0, 16) + '...',
        cacheSize: compileCache.size,
        maxSize: MAX_CACHE_ENTRIES,
      });
      compileCache.delete(oldestKey);
    }
  }

  compileCache.set(cacheKey, { payload: { ...payload }, timestamp: Date.now() });
}

/**
 * Gets cache statistics
 */
export function getCacheStats() {
  return {
    size: compileCache.size,
    maxSize: MAX_CACHE_ENTRIES,
    ttlMs: CACHE_TTL_MS,
  };
}

