import { NextRequest, NextResponse } from 'next/server';
import type { User } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';
import type { Tables, TablesInsert, TablesUpdate } from '@/database.types';
import { getContentTypeByFilename } from '@/lib/constants/file-types';
import { trackRedditConversion } from '@/lib/reddit-capi';
import {
  PENDING_DRAFT_COOKIE,
  clearPendingDraftCookie,
  importStartPath,
  isDraftId,
} from '@/lib/import/pending-draft';

type DraftRow = Pick<
  Tables<'drafts'>,
  'id' | 'title' | 'content' | 'source' | 'consumed_at' | 'consumed_by' | 'project_id'
>;

/** A user whose account is younger than this when the import completes counts as a sign-up. */
const NEW_USER_WINDOW_MS = 10 * 60 * 1000;

function redirectAndForget(url: URL) {
  // Every exit except the logged-out landing drops the cookie, so a stale or
  // already-consumed draft can never bounce the homepage back here.
  return clearPendingDraftCookie(NextResponse.redirect(url));
}

function projectUrl(origin: string, projectId: string, welcome: boolean) {
  const url = new URL(`/projects/${projectId}`, origin);
  if (welcome) url.searchParams.set('welcome', '1');
  return url;
}

function isNewUser(user: User, now = Date.now()) {
  if (!user.created_at) return false;
  const createdAt = Date.parse(user.created_at);
  return Number.isFinite(createdAt) && now - createdAt < NEW_USER_WINDOW_MS;
}

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const queryDraft = url.searchParams.get('draft');
  const cookieDraft = request.cookies.get(PENDING_DRAFT_COOKIE)?.value;
  const draftId = isDraftId(queryDraft)
    ? queryDraft
    : isDraftId(cookieDraft)
      ? cookieDraft
      : null;

  if (!draftId) {
    return redirectAndForget(new URL('/', url.origin));
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    // Logged out: show the "Open <title> in Octree" landing with sign-up /
    // login instead of a bare login redirect. The cookie stays so the draft
    // survives whichever auth path the visitor takes.
    return NextResponse.redirect(new URL(importStartPath(draftId), url.origin));
  }

  // The generated Database type resolves table rows to `never` in this repo,
  // so queries are cast like the rest of the codebase (see actions/*.ts).
  const { data: draft, error: draftError } = (await (supabase.from('drafts') as any)
    .select('id, title, content, source, consumed_at, consumed_by, project_id')
    .eq('id', draftId)
    .maybeSingle()) as { data: DraftRow | null; error: unknown };

  if (draftError || !draft) {
    return redirectAndForget(new URL('/', url.origin));
  }

  if (draft.consumed_at) {
    // Back button / double submit: send the owner to the project they already got.
    if (draft.consumed_by === user.id && draft.project_id) {
      return redirectAndForget(projectUrl(url.origin, draft.project_id, false));
    }
    return redirectAndForget(new URL('/', url.origin));
  }

  const title = draft.title || 'Imported from Tools';
  const content = draft.content;

  const projectData: TablesInsert<'projects'> = {
    title: title.slice(0, 120),
    user_id: user.id,
  };

  const { data: project, error: projectError } = (await (supabase.from('projects') as any)
    .insert(projectData)
    .select()
    .single()) as { data: Pick<Tables<'projects'>, 'id'> | null; error: unknown };

  if (projectError || !project) {
    console.error('Error creating project for draft:', projectError);
    return redirectAndForget(new URL('/', url.origin));
  }

  const mimeType = getContentTypeByFilename('main.tex');
  const blob = new Blob([content], { type: mimeType });
  const filePath = `projects/${project.id}/main.tex`;

  const { error: uploadError } = await supabase.storage
    .from('octree')
    .upload(filePath, blob, {
      cacheControl: '3600',
      upsert: false,
      contentType: mimeType,
    });

  if (uploadError) {
    console.error('Error uploading file to storage:', uploadError);
    return redirectAndForget(new URL('/', url.origin));
  }

  const { data: urlData } = supabase.storage.from('octree').getPublicUrl(filePath);

  const fileToInsert: TablesInsert<'files'> = {
    project_id: project.id,
    name: 'main.tex',
    type: mimeType,
    size: content.length,
    url: urlData.publicUrl,
  };

  const { error: fileError } = (await (supabase.from('files') as any).insert(
    fileToInsert
  )) as { error: unknown };

  if (fileError) {
    console.error('Error creating file record:', fileError);
    return redirectAndForget(projectUrl(url.origin, project.id, true));
  }

  // Keep the draft and mark it consumed so the funnel is measurable
  // (consumed_at IS NULL = abandoned). Non-fatal: the project already exists.
  const consumption: TablesUpdate<'drafts'> = {
    consumed_at: new Date().toISOString(),
    consumed_by: user.id,
    project_id: project.id,
  };
  const { error: consumeError } = (await (supabase.from('drafts') as any)
    .update(consumption)
    .eq('id', draftId)) as { error: unknown };

  if (consumeError) {
    console.error('Error marking draft consumed:', consumeError);
  }

  if (isNewUser(user)) {
    // Google sign-ups never reach the client-side SignUp pixel, so record the
    // conversion here. `lib/reddit-capi` has no custom-property support, so
    // the draft source is not attached. Keyed on the user id so a retry
    // (or a later caller using the same convention) dedupes on Reddit's side.
    try {
      await trackRedditConversion({
        eventName: 'SignUp',
        conversionId: `signup-${user.id}`,
        email: user.email ?? undefined,
        externalId: user.id,
        ipAddress:
          request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
          request.headers.get('x-real-ip') ||
          undefined,
        userAgent: request.headers.get('user-agent') || undefined,
      });
    } catch (error) {
      console.error('Reddit SignUp tracking failed:', error);
    }
  }

  // Always land in the editor; `welcome=1` lets the editor show its own
  // onboarding / Pro prompt instead of bouncing through /onboarding.
  return redirectAndForget(projectUrl(url.origin, project.id, true));
}
