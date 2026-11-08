'use server';

import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { FREE_FIRST_EXPORT_ENABLED } from '@/data/constants';
import { isProjectId } from '@/lib/checkout-plans';
import {
  freeExportClaimStatus,
  isMissingExportUnlockSchema,
  type FreeExportClaimStatus,
} from '@/lib/export-unlock';
import { hasUnlimitedEdits } from '@/lib/paywall';
import { proEntitlement } from '@/lib/subscription/entitlement';
import { AnalyticsEvents, type ExportFormat } from '@/lib/analytics/events';
import {
  captureServerEventAfterResponse,
  captureServerExceptionAfterResponse,
} from '@/lib/posthog-server';

/**
 * The free first export. Called by the editor toolbar when a free user who
 * has not used it yet clicks Export (lib/subscription/features.ts
 * `decideExport`); the server decides, the browser never grants anything.
 *
 * Granted through the service-role-only `claim_free_first_export` RPC
 * (migration 20261108120000): one `free_first` project_export_unlocks row per
 * account, on a project the user owns. The project then stays exportable,
 * like a bought unlock. An entitled user (allowlist, `unlimited`, an active
 * row) is answered `unlocked` without spending it.
 *
 * Never throws: anything unexpected is `unavailable`, and the toolbar shows
 * the paywall exactly as before this existed.
 */
export async function claimFreeFirstExport(
  projectId: string,
  format: ExportFormat
): Promise<{ status: FreeExportClaimStatus }> {
  if (!FREE_FIRST_EXPORT_ENABLED) return { status: 'unavailable' };
  if (!isProjectId(projectId) || (format !== 'pdf' && format !== 'zip')) {
    return { status: 'unavailable' };
  }

  let userId: string | null = null;
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return { status: 'unavailable' };
    userId = user.id;

    const { data: row } = await supabase
      .from('user_usage')
      .select('subscription_status, stripe_subscription_id, current_period_end')
      .eq('user_id', user.id)
      .maybeSingle();
    if (proEntitlement({ row, hasUnlimited: hasUnlimitedEdits(user.email) }).isPro) {
      return { status: 'unlocked' };
    }

    const { data, error } = await createAdminClient().rpc('claim_free_first_export', {
      p_user_id: user.id,
      p_project_id: projectId,
    });
    if (error) {
      if (!isMissingExportUnlockSchema(error)) throw error;
      console.error('[free-export] 20261108120000_free_first_export.sql not applied; no free export');
      return { status: 'unavailable' };
    }

    const status = freeExportClaimStatus(data);
    if (status === 'granted') {
      captureServerEventAfterResponse(user.id, AnalyticsEvents.EXPORT_FREE_USED, {
        project_id: projectId,
        format,
      });
    }
    return { status };
  } catch (error) {
    console.error('[free-export] claim failed:', error);
    captureServerExceptionAfterResponse(error, { distinctId: userId, route: 'actions/claim-free-export' });
    return { status: 'unavailable' };
  }
}
