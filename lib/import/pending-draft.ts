import type { NextResponse } from 'next/server';

/**
 * Cookie that remembers the draft a visitor posted from tools.useoctree.com
 * ("Open in Octree") while they sign up or log in. The import route reads it
 * when the `draft` query param is missing (e.g. after an OAuth round trip that
 * dropped `next`) and clears it once the draft has been turned into a project.
 */
export const PENDING_DRAFT_COOKIE = 'octree_pending_draft';

export const PENDING_DRAFT_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Draft ids are uuids; anything else (tampered cookie, stray query) is ignored. */
export function isDraftId(value: string | null | undefined): value is string {
  return typeof value === 'string' && UUID_RE.test(value);
}

export function setPendingDraftCookie(response: NextResponse, draftId: string) {
  response.cookies.set(PENDING_DRAFT_COOKIE, draftId, {
    httpOnly: true,
    sameSite: 'lax',
    // Browsers treat http://localhost as a secure context except Safari, so
    // only drop the flag for local `next dev`.
    secure: process.env.NODE_ENV !== 'development',
    path: '/',
    maxAge: PENDING_DRAFT_MAX_AGE_SECONDS,
  });
  return response;
}

export function clearPendingDraftCookie(response: NextResponse) {
  response.cookies.set(PENDING_DRAFT_COOKIE, '', {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV !== 'development',
    path: '/',
    maxAge: 0,
  });
  return response;
}

/** Reads the draft id from a raw `Cookie` header (for handlers that get a plain `Request`). */
export function pendingDraftFromCookieHeader(cookieHeader: string | null): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === PENDING_DRAFT_COOKIE) {
      const value = decodeURIComponent(rest.join('='));
      return isDraftId(value) ? value : null;
    }
  }
  return null;
}

export function importPath(draftId: string) {
  return `/import?draft=${encodeURIComponent(draftId)}`;
}

export function importStartPath(draftId: string) {
  return `/import/start?draft=${encodeURIComponent(draftId)}`;
}
