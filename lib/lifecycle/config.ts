import type { LifecycleTemplate } from '@/lib/email/lifecycle';

/**
 * Which templates this deployment may send. welcome / limit_hit / day7 are
 * on; winback is behind LIFECYCLE_WINBACK_ENABLED=true so the first batch to
 * lapsed payers is a deliberate decision by the owner.
 */
export function enabledTemplates(env: Record<string, string | undefined> = process.env): Set<LifecycleTemplate> {
  const enabled = new Set<LifecycleTemplate>(['welcome', 'limit_hit', 'day7']);
  if (env.LIFECYCLE_WINBACK_ENABLED === 'true') enabled.add('winback');
  return enabled;
}
