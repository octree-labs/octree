import type { ScheduledLifecycleTemplate } from '@/lib/email/lifecycle';

/**
 * Which scheduled templates this deployment may send. limit_hit /
 * pro_inactive / warm_lead_offer are on. welcome and day7 are paused until
 * they are rewritten (over 30 days nearly every human click on either was an
 * unsubscribe, and no recipient bought within 7 days): they only go out with
 * LIFECYCLE_WELCOME_ENABLED=true / LIFECYCLE_DAY7_ENABLED=true. winback is
 * behind LIFECYCLE_WINBACK_ENABLED=true so the first batch to lapsed payers
 * is a deliberate decision by the owner. warm_lead_offer (50% off the first
 * Pro month after a paywall hit) can be switched off with
 * LIFECYCLE_WARM_LEAD_OFFER_ENABLED=false.
 * Disabled templates are still evaluated, so the cron's dry run reports
 * their eligible counts with `enabled: false`.
 * The billing-recovery templates (lib/lifecycle/billing-recovery.ts) are
 * always on: a failed-payment notice is an account notice, not a campaign.
 */
export function enabledTemplates(env: Record<string, string | undefined> = process.env): Set<ScheduledLifecycleTemplate> {
  const enabled = new Set<ScheduledLifecycleTemplate>(['limit_hit', 'pro_inactive']);
  if (env.LIFECYCLE_WELCOME_ENABLED === 'true') enabled.add('welcome');
  if (env.LIFECYCLE_DAY7_ENABLED === 'true') enabled.add('day7');
  if (env.LIFECYCLE_WINBACK_ENABLED === 'true') enabled.add('winback');
  if (env.LIFECYCLE_WARM_LEAD_OFFER_ENABLED !== 'false') enabled.add('warm_lead_offer');
  return enabled;
}
