import { type EmailOtpType } from '@supabase/supabase-js';
import { type NextRequest } from 'next/server';
import { redirect } from 'next/navigation';

import { createClient } from '@/lib/supabase/server';
import { inngest } from '@/lib/inngest/client';
import { PENDING_DRAFT_COOKIE, isDraftId } from '@/lib/import/pending-draft';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const token_hash = searchParams.get('token_hash');
  const type = searchParams.get('type') as EmailOtpType | null;
  // No explicit `next` (e.g. the email template's default): if the visitor
  // still has a pending "Open in Octree" draft, finish that import first.
  // Password recovery and email change keep their own flow regardless.
  const resumeImport =
    type !== 'recovery' &&
    type !== 'email_change' &&
    isDraftId(request.cookies.get(PENDING_DRAFT_COOKIE)?.value);
  const next = searchParams.get('next') ?? (resumeImport ? '/import' : '/onboarding');

  if (token_hash && type) {
    const supabase = await createClient();

    const {
      data: { user },
      error,
    } = await supabase.auth.verifyOtp({
      type,
      token_hash,
    });

    if (!error) {
      if (user?.email && user?.id) {
        try {
          await inngest.send({
            name: 'user/confirmed',
            data: { email: user.email, userId: user.id },
          });
        } catch {
          // non-fatal — auth flow must not be blocked by email errors
        }
      }

      redirect(next);
    }
  }

  redirect('/error');
}
