import { describe, it, expect } from 'vitest';
import {
  isDraftId,
  pendingDraftFromCookieHeader,
  importPath,
  importStartPath,
} from '@/lib/import/pending-draft';

const ID = '11111111-2222-4333-8444-555555555555';

describe('pending-draft helpers', () => {
  it('accepts uuids only', () => {
    expect(isDraftId(ID)).toBe(true);
    expect(isDraftId('nope')).toBe(false);
    expect(isDraftId(null)).toBe(false);
    expect(isDraftId(undefined)).toBe(false);
  });

  it('reads the draft id out of a raw Cookie header', () => {
    expect(pendingDraftFromCookieHeader(`sb-token=abc; octree_pending_draft=${ID}; other=1`)).toBe(ID);
    expect(pendingDraftFromCookieHeader('octree_pending_draft=garbage')).toBeNull();
    expect(pendingDraftFromCookieHeader(null)).toBeNull();
    expect(pendingDraftFromCookieHeader('sb-token=abc')).toBeNull();
  });

  it('builds the import paths', () => {
    expect(importPath(ID)).toBe(`/import?draft=${ID}`);
    expect(importStartPath(ID)).toBe(`/import/start?draft=${ID}`);
  });
});
