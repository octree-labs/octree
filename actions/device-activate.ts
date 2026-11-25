'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { createApiKeyForUser } from '@/lib/api/create-key';
import { AnalyticsEvents } from '@/lib/analytics/events';
import { captureServerEventAfterResponse } from '@/lib/posthog-server';
import { allowActivateAttempt } from '@/lib/device/activate-limit';
import { activatePath, loginPathForActivate, normalizeUserCode } from '@/lib/device/codes';
import { deviceFlowSecret } from '@/lib/device/crypto';
import { approveDeviceAuthorization, denyDeviceAuthorization, type DecisionResult } from '@/lib/device/flow';
import { createDeviceStore } from '@/lib/device/store';
import { parseDecision } from '@/lib/oauth/consent';

/**
 * Approve or deny a device authorization from /activate. Approving creates
 * an ordinary API key for the signed-in user with their own session
 * (lib/api/create-key.ts, same 5-key cap as Settings), and hands it to the
 * waiting agent encrypted (lib/device/flow.ts). Server actions are
 * same-origin only (Next.js checks Origin), which covers CSRF.
 */

const REQUEST_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function decideDeviceAuthorization(formData: FormData): Promise<void> {
  const typed = formData.get('user_code');
  const userCode = normalizeUserCode(typed);
  const requestId = formData.get('request_id');
  const decision = parseDecision(formData.get('decision'));

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(loginPathForActivate(userCode));

  if (!userCode || typeof requestId !== 'string' || !REQUEST_ID_RE.test(requestId) || !decision) {
    redirect(activatePath({ code: userCode, error: 'invalid' }));
  }
  if (!allowActivateAttempt(user.id)) redirect(activatePath({ code: userCode, error: 'rate_limited' }));

  const store = createDeviceStore();
  const now = Date.now();
  let result: DecisionResult;
  try {
    result =
      decision === 'approve'
        ? await approveDeviceAuthorization(store, {
            requestId,
            userCode,
            userId: user.id,
            now,
            secret: deviceFlowSecret(),
            createKey: (name) => createApiKeyForUser(supabase, user.id, name),
          })
        : await denyDeviceAuthorization(store, { requestId, userCode, userId: user.id, now });
  } catch (error) {
    console.error('[device-activate] decision failed:', error instanceof Error ? error.message : 'unknown error');
    result = { ok: false, reason: 'failed' };
  }

  if (!result.ok) {
    // not_found also covers a code edited on the page: /activate?code=<typed>
    // then shows the request that code belongs to, if any.
    const error = result.reason === 'limit' ? 'key_limit' : result.reason;
    redirect(activatePath({ code: userCode, error }));
  }

  const props = { client_name: result.row.client_name, request_id: result.row.id };
  if (decision === 'approve') {
    captureServerEventAfterResponse(user.id, AnalyticsEvents.DEVICE_AUTHORIZATION_APPROVED, props);
    revalidatePath('/settings/account');
    redirect(activatePath({ done: 'approved' }));
  }
  captureServerEventAfterResponse(user.id, AnalyticsEvents.DEVICE_AUTHORIZATION_DENIED, props);
  redirect(activatePath({ done: 'denied' }));
}
