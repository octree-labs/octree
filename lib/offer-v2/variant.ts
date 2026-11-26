/**
 * The onboarding offer A/B test: PostHog multivariate feature flag
 * `onboarding-offer-v2` with variants `control` (the plan step and paywall
 * as they were) and `offer_v2` (lib/offer-v2/offer.ts: outcome headline,
 * value stack, guarantee, annual first, Deadline Pass, honest first-purchase
 * deadline, downsell). Pure and browser-safe; evaluation is server side
 * (lib/offer-v2/variant-server.ts).
 *
 * `NEXT_PUBLIC_OFFER_V2=on|off` forces a variant for everyone (testing on a
 * preview, or an instant rollback without touching PostHog). Anything else,
 * or unset, leaves it to the flag; an unknown flag value, no PostHog, or a
 * timeout is `control`.
 */

export const OFFER_V2_FLAG_KEY = 'onboarding-offer-v2';

export const OFFER_VARIANTS = ['control', 'offer_v2'] as const;
export type OfferVariant = (typeof OFFER_VARIANTS)[number];

export const DEFAULT_OFFER_VARIANT: OfferVariant = 'control';

export function isOfferVariant(value: unknown): value is OfferVariant {
  return typeof value === 'string' && (OFFER_VARIANTS as readonly string[]).includes(value);
}

/** The variant `NEXT_PUBLIC_OFFER_V2` forces, or null when it leaves it to the flag. */
export function offerVariantOverride(value: string | null | undefined): OfferVariant | null {
  const normalized = value?.trim().toLowerCase();
  if (normalized === 'on') return 'offer_v2';
  if (normalized === 'off') return 'control';
  return null;
}

/** A flag answer (string variant, boolean, undefined) as a variant; anything unknown is control. */
export function offerVariantFromFlag(value: unknown): OfferVariant {
  return isOfferVariant(value) ? value : DEFAULT_OFFER_VARIANT;
}

export function resolveOfferVariant(input: {
  override: string | null | undefined;
  flagValue: unknown;
}): OfferVariant {
  return offerVariantOverride(input.override) ?? offerVariantFromFlag(input.flagValue);
}

/** Whether an account (auth.users.created_at) is in the experiment; unknown dates are not. */
export function inOfferExperiment(createdAt: string | null | undefined, since: string): boolean {
  const created = Date.parse(createdAt ?? '');
  return Number.isFinite(created) && created >= Date.parse(since);
}

/**
 * The variant a request acts on, from what is stored: the env override,
 * else the persisted assignment (user_usage.offer_variant), else control.
 * Checkout uses this; it never evaluates the flag.
 */
export function effectiveOfferVariant(
  persisted: unknown,
  override: string | null | undefined
): OfferVariant {
  return offerVariantOverride(override) ?? (isOfferVariant(persisted) ? persisted : DEFAULT_OFFER_VARIANT);
}
