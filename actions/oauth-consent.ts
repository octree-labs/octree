'use server';

import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import {
  CONSENT_PATH,
  isValidAuthorizationId,
  loginPathForConsent,
  parseDecision,
  runConsentDecision,
} from '@/lib/oauth/consent';

/**
 * Approve or deny an OAuth authorization request from the consent page
 * (app/oauth/consent). Runs with the signed-in user's session, which is what
 * Supabase Auth checks; then sends the browser back to the client (with an
 * authorization code, or `error=access_denied`). Server actions are
 * same-origin only (Next.js checks Origin), which covers CSRF.
 */
export async function decideOAuthConsent(formData: FormData): Promise<void> {
  const authorizationId = formData.get('authorization_id');
  const decision = parseDecision(formData.get('decision'));
  if (!isValidAuthorizationId(authorizationId) || !decision) redirect(CONSENT_PATH);

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(loginPathForConsent(authorizationId));

  const destination = await runConsentDecision(supabase.auth.oauth, authorizationId, decision);
  redirect(destination);
}
