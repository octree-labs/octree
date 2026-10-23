import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import type { Tables } from '@/database.types';
import { OctreeLogo, OctreeWordmark } from '@/components/icons/octree-logo';
import { ImportGuestLanding } from '@/components/import/import-guest-landing';
import {
  PENDING_DRAFT_COOKIE,
  importPath,
  isDraftId,
} from '@/lib/import/pending-draft';
import { sourceLabel, sourceSite } from '@/lib/import/source';
import { appendUtmParams } from '@/lib/utm';

export const metadata: Metadata = {
  title: 'Open in Octree',
  description: 'Sign up or log in to open this LaTeX document in Octree.',
  robots: { index: false, follow: false },
};

const PREVIEW_LINES = 25;
const PREVIEW_MAX_CHARS = 2000;

function previewOf(content: string): { text: string; truncated: boolean } {
  const lines = content.split('\n');
  let text = lines.slice(0, PREVIEW_LINES).join('\n');
  let truncated = lines.length > PREVIEW_LINES;
  if (text.length > PREVIEW_MAX_CHARS) {
    text = text.slice(0, PREVIEW_MAX_CHARS);
    truncated = true;
  }
  return { text, truncated };
}

interface PageProps {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

export default async function ImportStartPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const cookieStore = await cookies();
  const queryDraft = typeof params.draft === 'string' ? params.draft : null;
  const cookieDraft = cookieStore.get(PENDING_DRAFT_COOKIE)?.value ?? null;
  const draftId = isDraftId(queryDraft)
    ? queryDraft
    : isDraftId(cookieDraft)
      ? cookieDraft
      : null;

  if (!draftId) {
    redirect('/');
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Already signed in: the import route creates the project.
  if (user) {
    // Carry the tools' utm_* params so the app's first pageview records them.
    const query = new URLSearchParams(
      Object.entries(params).filter((e): e is [string, string] => typeof e[1] === 'string')
    );
    const target = appendUtmParams(new URL(importPath(draftId), 'http://localhost'), query);
    redirect(`${target.pathname}${target.search}`);
  }

  // `drafts` has an anon SELECT policy (drafts_select_any), so the cookie-based
  // server client can read it without the service role. Ids are uuids, so the
  // only draft a visitor can see is the one whose id they were given.
  const { data: draft } = (await (supabase.from('drafts') as any)
    .select('id, title, content, source, consumed_at')
    .eq('id', draftId)
    .maybeSingle()) as {
    data: Pick<Tables<'drafts'>, 'id' | 'title' | 'content' | 'source' | 'consumed_at'> | null;
  };

  if (!draft || draft.consumed_at) {
    redirect('/');
  }

  const title = draft.title || 'Imported from Tools';
  const preview = previewOf(draft.content);
  const nextPath = importPath(draftId);

  return (
    <div className="flex min-h-screen w-full flex-col bg-background">
      <header className="flex items-center gap-2 p-6">
        <OctreeLogo className="h-6 w-6" />
        <OctreeWordmark className="text-lg" />
      </header>

      {/*
        Logged-out only (signed-in visitors were redirected to /import above).
        The PDF preview is fetched client-side from /api/import/preview so a
        slow compile never blocks the sign-up column from rendering.
      */}
      <ImportGuestLanding
        draftId={draftId}
        title={title}
        source={draft.source ?? ''}
        sourceLabel={sourceLabel(draft.source)}
        sourceSite={sourceSite(draft.source)}
        latexPreview={preview.text}
        latexTruncated={preview.truncated}
        nextPath={nextPath}
      />
    </div>
  );
}
