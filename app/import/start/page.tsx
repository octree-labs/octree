import type { Metadata } from 'next';
import Link from 'next/link';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import type { Tables } from '@/database.types';
import { GoogleOAuthButton } from '@/components/auth/google-oauth-button';
import { SignUpForm } from '@/components/auth/signup-form';
import { OctreeLogo, OctreeWordmark } from '@/components/icons/octree-logo';
import {
  PENDING_DRAFT_COOKIE,
  importPath,
  isDraftId,
} from '@/lib/import/pending-draft';

export const metadata: Metadata = {
  title: 'Open in Octree',
  description: 'Sign up or log in to open this LaTeX document in Octree.',
  robots: { index: false, follow: false },
};

const PREVIEW_LINES = 25;
const PREVIEW_MAX_CHARS = 2000;

/** `tools:tikz-generator` -> `TikZ Generator`-ish label for the badge. */
function sourceLabel(source: string | null): string | null {
  if (!source) return null;
  const slug = source.replace(/^tools:/, '').replace(/[-_]+/g, ' ').trim();
  if (!slug) return null;
  return slug.replace(/\b\w/g, (c) => c.toUpperCase());
}

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
    redirect(importPath(draftId));
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
  const source = sourceLabel(draft.source);
  const preview = previewOf(draft.content);
  const nextPath = importPath(draftId);

  return (
    <div className="flex min-h-screen w-full flex-col bg-background">
      <header className="flex items-center gap-2 p-6">
        <OctreeLogo className="h-6 w-6" />
        <OctreeWordmark className="text-lg" />
      </header>

      <main className="mx-auto grid w-full max-w-5xl flex-1 gap-10 px-6 pb-12 lg:grid-cols-[minmax(0,1fr)_380px]">
        <section className="min-w-0">
          <p className="text-sm text-muted-foreground">
            From Octree Tools{source ? ` · ${source}` : ''}
          </p>
          <h1 className="mt-2 break-words text-3xl font-semibold tracking-tight">
            Open <span className="text-primary">{title}</span> in Octree
          </h1>
          <p className="mt-3 text-muted-foreground">
            Create a free account to edit, compile to PDF, and write with AI
            assistance. Your document is saved and will be waiting for you.
          </p>

          <div className="mt-6 overflow-hidden rounded-lg border bg-muted/40">
            <div className="flex items-center justify-between border-b px-4 py-2 text-xs text-muted-foreground">
              <span className="font-mono">main.tex</span>
              <span>Preview</span>
            </div>
            <pre className="max-h-96 overflow-auto p-4 font-mono text-xs leading-relaxed">
              {preview.text}
              {preview.truncated ? '\n…' : ''}
            </pre>
          </div>
        </section>

        <aside className="flex flex-col gap-4">
          <GoogleOAuthButton nextPath={nextPath} label="Continue with Google" />

          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <span className="h-px flex-1 bg-border" />
            or sign up with email
            <span className="h-px flex-1 bg-border" />
          </div>

          <SignUpForm nextPath={nextPath} />

          <p className="text-center text-sm text-muted-foreground">
            Already have an account?{' '}
            <Link
              href={`/auth/login?next=${encodeURIComponent(nextPath)}`}
              className="underline underline-offset-4"
            >
              Log in
            </Link>
          </p>
        </aside>
      </main>
    </div>
  );
}
