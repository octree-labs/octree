import type { ScheduledLifecycleTemplate } from '@/lib/email/lifecycle';

/**
 * Which scheduled templates this deployment may send. welcome / limit_hit /
 * day7 / pro_inactive are on; winback is behind LIFECYCLE_WINBACK_ENABLED=true
 * so the first batch to lapsed payers is a deliberate decision by the owner.
 * The billing-recovery templates (lib/lifecycle/billing-recovery.ts) are
 * always on: a failed-payment notice is an account notice, not a campaign.
 */
export function enabledTemplates(env: Record<string, string | undefined> = process.env): Set<ScheduledLifecycleTemplate> {
  const enabled = new Set<ScheduledLifecycleTemplate>(['welcome', 'limit_hit', 'day7', 'pro_inactive']);
  if (env.LIFECYCLE_WINBACK_ENABLED === 'true') enabled.add('winback');
  return enabled;
}
