import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import {
  captureServerEventAfterResponse,
  captureServerExceptionAfterResponse,
} from '@/lib/posthog-server';
import type Stripe from 'stripe';
import { stripe } from '@/lib/stripe';
import { AnalyticsEvents } from '@/lib/analytics/events';
import { hasUnlimitedEdits } from '@/lib/paywall';
import {
  isRevokingStripeStatus,
  proEntitlement,
  revokedRowStatus,
  rowClaimsPro,
  type RevokingStripeStatus,
  type StripeStatusReport,
} from '@/lib/subscription/entitlement';
import { resolveStripeCustomer } from '@/lib/stripe-customer';
import { resolveFirstPurchaseOffer } from '@/lib/first-purchase-offer-server';
import {
  appliedCouponId,
  effectiveSubscriptionStatus,
  isProStatus,
  pausePaidThrough,
  pauseResumesAt,
  subscriptionHasDiscount,
} from '@/lib/stripe-subscription';
import type { Tables } from '@/database.types';
import {
  FREE_DAILY_EDIT_LIMIT,
  FREE_GENERATION_ALLOWANCE,
  PRO_MONTHLY_EDIT_LIMIT,
} from '@/data/constants';
import {
  billingRowMatches,
  type IncomingSubscription,
} from '@/lib/subscription/billing-period';

// Reads go through the user-session client (`supabase`); every write in this
// route touches billing or quota columns, which the user_usage guard trigger
// only lets the service role change, so writes go through `admin`.

function getResetDate(): string {
  return new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
    .toISOString()
    .split('T')[0];
}

async function getOrCreateUsageData(
  supabase: any,
  admin: any,
  userId: string,
  hasUnlimited: boolean
): Promise<Tables<'user_usage'> | null> {
  const { data: usageData, error: usageError } = await supabase
    .from('user_usage')
    .select('*')
    .eq('user_id', userId)
    .single();

  if (!usageError) return usageData;

  if (usageError.code === 'PGRST116') {
    console.log('Creating new user_usage record for user:', userId);
    const { data, error } = await admin
      .from('user_usage')
      .insert({
        user_id: userId,
        edit_count: 0,
        monthly_edit_count: 0,
        monthly_reset_date: getResetDate(),
        is_pro: hasUnlimited,
        subscription_status: hasUnlimited ? 'unlimited' : 'inactive',
      })
      .select('*')
      .single();

    if (error || !data) {
      console.error('Error creating user_usage record:', error);
      return null;
    }
    return data;
  }

  console.error('Error fetching usage data:', usageError);
  return null;
}

async function handleMonthlyReset(
  admin: any,
  userId: string,
  usageData: Tables<'user_usage'>
): Promise<Tables<'user_usage'>> {
  if (!usageData.monthly_reset_date) return usageData;

  const resetDate = new Date(usageData.monthly_reset_date);
  if (new Date() < resetDate) return usageData;

  const { error } = await admin
    .from('user_usage')
    .update({
      monthly_edit_count: 0,
      monthly_reset_date: getResetDate(),
    })
    .eq('user_id', userId);

  if (!error) {
    usageData.monthly_edit_count = 0;
  }

  return usageData;
}

async function ensureUnlimitedStatus(
  admin: any,
  userId: string,
  usageData: Tables<'user_usage'>
): Promise<Tables<'user_usage'>> {
  const hasPaidStatus = ['active', 'trialing'].includes(
    usageData.subscription_status ?? ''
  );

  const needsUpdate =
    !usageData.is_pro ||
    (!hasPaidStatus && usageData.subscription_status !== 'unlimited');

  if (!needsUpdate) return usageData;

  const { data, error } = await admin
    .from('user_usage')
    .update({
      is_pro: true,
      subscription_status: hasPaidStatus
        ? usageData.subscription_status
        : 'unlimited',
    })
    .eq('user_id', userId)
    .select('*')
    .single();

  return error ? usageData : data;
}

/**
 * The user's Stripe customer id, or null. `lookupFailed` tells a Stripe
 * error apart from "no customer": the route still answers (as before) with
 * no subscription, but the first-purchase offer is withheld.
 */
async function findStripeCustomerId(
  supabase: any,
  user: { id: string; email?: string | null }
): Promise<{ customerId: string | null; lookupFailed: boolean }> {
  try {
    const resolved = await resolveStripeCustomer(supabase, user);
    return { customerId: resolved?.customerId ?? null, lookupFailed: false };
  } catch (error) {
    console.error('Error fetching Stripe customer:', error);
    return { customerId: null, lookupFailed: true };
  }
}

/**
 * The customer's subscription, live first. A past_due / unpaid one is
 * returned too (after active and trialing) so the client can show the
 * past-due banner; it grants no Pro: `effective_status` says past_due and
 * `buildUsageResponse` only treats `active` as Pro.
 *
 * One `status: 'all'` list per request, newest first, and the best status
 * wins: this route runs on every page load, and a free user with a customer
 * record would otherwise cost one Stripe round trip per status looked up
 * before answering "no subscription".
 */
const STATUS_LOOKUP_ORDER = ['active', 'trialing', 'past_due', 'unpaid'] as const;

function pickSubscription<T extends Pick<Stripe.Subscription, 'status'>>(subscriptions: T[]): T | null {
  for (const status of STATUS_LOOKUP_ORDER) {
    const found = subscriptions.find((sub) => sub.status === status);
    if (found) return found;
  }
  return null;
}

async function findActiveSubscription(
  customerId: string
): Promise<Stripe.Subscription | null> {
  const subs = await stripe.subscriptions.list({
    customer: customerId,
    status: 'all',
    limit: 20,
  });
  return pickSubscription(subs.data);
}

function buildUsageResponse(
  usageData: Tables<'user_usage'> | null,
  hasUnlimited: boolean,
  subscription?: Stripe.Subscription | null,
  /** Stripe's answer for the row's stored subscription when no live one was found. */
  storedStripeStatus: StripeStatusReport = null
) {
  const editCount = usageData?.edit_count || 0;
  const monthlyEditCount = usageData?.monthly_edit_count || 0;
  // Paused collection reads as the free tier once the paid period has ended
  // (see lib/stripe-subscription.ts). `usageData.is_pro` was read before the
  // RPC below rewrote it, so it must not be trusted for a paused subscription.
  const effectiveStatus = subscription ? effectiveSubscriptionStatus(subscription) : null;
  const isActive = effectiveStatus === 'active';

  // Pro by the shared rule (lib/subscription/entitlement.ts): Stripe's
  // answer when there is one, else the allowlist, the `unlimited` grant, or
  // an active row whose period has not ended. `is_pro` alone grants nothing.
  const entitlement = proEntitlement({
    row: usageData,
    stripeStatus: effectiveStatus ?? storedStripeStatus,
    hasUnlimited,
  });

  const baseRemainingEdits = isActive
    ? Math.max(0, PRO_MONTHLY_EDIT_LIMIT - monthlyEditCount)
    : Math.max(0, FREE_DAILY_EDIT_LIMIT - editCount);

  // Purchased credits (never expire) keep the editor open once the
  // allowance is spent, so the limit flags the client gates on only trip
  // when the credits are gone too.
  const editCredits = usageData?.edit_credits ?? 0;
  const allowanceSpent = isActive
    ? monthlyEditCount >= PRO_MONTHLY_EDIT_LIMIT
    : editCount >= FREE_DAILY_EDIT_LIMIT;

  return {
    editCount,
    monthlyEditCount,
    remainingEdits: hasUnlimited ? null : baseRemainingEdits,
    remainingMonthlyEdits: hasUnlimited
      ? null
      : isActive
        ? baseRemainingEdits
        : 0,
    editCredits,
    isPro: entitlement.isPro,
    proSource: entitlement.isPro ? entitlement.source : null,
    // The row fields the client needs to apply the same rule
    // (entitlementFromStatusResponse in lib/subscription/entitlement.ts).
    subscriptionStatus: usageData?.subscription_status ?? null,
    currentPeriodEnd: usageData?.current_period_end ?? null,
    hasStripeSubscription: Boolean(usageData?.stripe_subscription_id),
    stripeStatus: storedStripeStatus ?? null,
    limitReached: hasUnlimited ? false : allowanceSpent && editCredits <= 0,
    monthlyLimitReached: hasUnlimited
      ? false
      : isActive
        ? allowanceSpent && editCredits <= 0
        : false,
    monthlyResetDate: usageData?.monthly_reset_date || null,
    hasUnlimitedEdits: hasUnlimited,
    // Generate allowance (consume_generation decides for real; this drives
    // the badge and the paywall offers on /generate).
    freeGenerationsRemaining: Math.max(
      0,
      FREE_GENERATION_ALLOWANCE - (usageData?.free_generations_used ?? 0)
    ),
    generationCredits: Math.max(0, usageData?.generation_credits ?? 0),
  };
}

async function updateSubscriptionInDB(
  admin: any,
  userId: string,
  customerId: string,
  subscription: Stripe.Subscription,
  usageData: Tables<'user_usage'>
) {
  const effectiveStatus = effectiveSubscriptionStatus(subscription);
  const incoming: IncomingSubscription = {
    customerId,
    subscriptionId: subscription.id,
    // `paused` (not Stripe's `active`) so the RPC derives is_pro = false
    // while collection is paused, matching the webhook.
    status: effectiveStatus,
    isPro: isProStatus(effectiveStatus),
    currentPeriodStart: new Date(subscription.current_period_start * 1000).toISOString(),
    currentPeriodEnd: new Date(subscription.current_period_end * 1000).toISOString(),
    cancelAtPeriodEnd: subscription.cancel_at_period_end,
  };

  // This runs on every page load. When the row already says what Stripe
  // says there is nothing to write, and the RPC itself only resets
  // monthly_edit_count when the billing period advances
  // (lib/subscription/billing-period.ts, migration 20261018140000).
  if (billingRowMatches(usageData, incoming)) return;

  try {
    // EXECUTE on this function is revoked from `authenticated`; only the
    // service role may call it.
    const { error } = await admin.rpc('update_user_subscription_status', {
      p_user_id: userId,
      p_stripe_customer_id: customerId,
      p_stripe_subscription_id: subscription.id,
      p_subscription_status: incoming.status,
      p_current_period_start: incoming.currentPeriodStart,
      p_current_period_end: incoming.currentPeriodEnd,
      p_cancel_at_period_end: incoming.cancelAtPeriodEnd,
    });
    if (error) {
      console.error('Error updating subscription status in database:', error);
    }
  } catch (error) {
    console.error('Error updating subscription status in database:', error);
  }
}

/**
 * What Stripe says about the subscription id the row remembers, for a row
 * that still claims Pro although no active/trialing subscription was found
 * for the customer. `missing` is a 404 (the subscription, or the whole
 * customer, was deleted). Any other Stripe failure reports `null` (not
 * consulted): the row rule then decides, and nothing is rewritten.
 */
async function lookupStoredSubscription(
  subscriptionId: string
): Promise<{ status: StripeStatusReport; subscription: Stripe.Subscription | null }> {
  try {
    const subscription = await stripe.subscriptions.retrieve(subscriptionId);
    return { status: effectiveSubscriptionStatus(subscription), subscription };
  } catch (error: any) {
    if (error?.code === 'resource_missing' || error?.statusCode === 404) {
      return { status: 'missing', subscription: null };
    }
    console.error('Error retrieving stored Stripe subscription:', error);
    return { status: null, subscription: null };
  }
}

/**
 * Self-heal: the row says Pro, Stripe says the subscription is gone. Writes
 * `is_pro = false` and Stripe's status (`canceled` / `incomplete_expired`,
 * and `canceled` for a 404: what the webhook would have written for the
 * same event) through the same service-role RPC every other subscription
 * write uses (the RPC derives is_pro from the status), keeping the
 * subscription id as a record of what the user had. Returns the row as it
 * now stands; on failure the stale row is returned unchanged, but the
 * response is already computed from Stripe's answer, so the user does not
 * get Pro either way.
 */
async function revokeStaleEntitlement(
  admin: any,
  userId: string,
  usageData: Tables<'user_usage'>,
  customerId: string | null,
  stripeStatus: RevokingStripeStatus,
  stripeSubscription: Stripe.Subscription | null
): Promise<Tables<'user_usage'>> {
  const status = revokedRowStatus(stripeStatus);
  const periodStart = stripeSubscription?.current_period_start
    ? new Date(stripeSubscription.current_period_start * 1000).toISOString()
    : usageData.current_period_start;
  const periodEnd = stripeSubscription?.current_period_end
    ? new Date(stripeSubscription.current_period_end * 1000).toISOString()
    : usageData.current_period_end;

  try {
    const { error } = await admin.rpc('update_user_subscription_status', {
      p_user_id: userId,
      p_stripe_customer_id: usageData.stripe_customer_id ?? customerId,
      p_stripe_subscription_id: usageData.stripe_subscription_id,
      p_subscription_status: status,
      p_current_period_start: periodStart,
      p_current_period_end: periodEnd,
      p_cancel_at_period_end:
        stripeSubscription?.cancel_at_period_end ?? usageData.cancel_at_period_end ?? false,
    });
    if (error) {
      console.error('Error revoking stale Pro entitlement:', error);
      return usageData;
    }
  } catch (error) {
    console.error('Error revoking stale Pro entitlement:', error);
    return usageData;
  }

  return {
    ...usageData,
    is_pro: false,
    subscription_status: status,
    current_period_start: periodStart,
    current_period_end: periodEnd,
  };
}

export async function GET() {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const hasUnlimited = hasUnlimitedEdits(user.email);
    const admin = createAdminClient();

    let usageData = await getOrCreateUsageData(
      supabase,
      admin,
      user.id,
      hasUnlimited
    );
    if (!usageData) {
      return NextResponse.json(
        { error: 'Failed to get usage data' },
        { status: 500 }
      );
    }

    usageData = await handleMonthlyReset(admin, user.id, usageData);

    if (hasUnlimited) {
      usageData = await ensureUnlimitedStatus(admin, user.id, usageData);
    }

    const { customerId, lookupFailed: customerLookupFailed } = await findStripeCustomerId(supabase, user);
    const subscription = customerId ? await findActiveSubscription(customerId) : null;

    if (!subscription || !customerId) {
      // No live subscription, but the row still claims Pro: ask Stripe about
      // the subscription it remembers and, when that one is gone for good,
      // rewrite the row to the free tier so it stops lying on the next read
      // (and for the routes that read `is_pro` directly).
      let storedStatus: StripeStatusReport = null;
      if (rowClaimsPro(usageData, hasUnlimited) && usageData.stripe_subscription_id) {
        const stored = await lookupStoredSubscription(usageData.stripe_subscription_id);
        storedStatus = stored.status;
        if (isRevokingStripeStatus(storedStatus)) {
          const previousStatus = usageData.subscription_status ?? null;
          usageData = await revokeStaleEntitlement(
            admin,
            user.id,
            usageData,
            customerId,
            storedStatus,
            stored.subscription
          );
          captureServerEventAfterResponse(user.id, AnalyticsEvents.PRO_ENTITLEMENT_REVOKED, {
            reason: storedStatus,
            previous_status: previousStatus,
          });
        }
      }

      // 50% off the first Pro month for an account that has never bought
      // anything (lib/first-purchase-offer.ts); the paywall and /buy show it.
      const firstPurchaseOffer = await resolveFirstPurchaseOffer(admin, user.id, usageData, {
        hasUnlimited,
        stripeStatus: storedStatus,
        stripeCustomer: customerLookupFailed ? 'unknown' : Boolean(customerId),
      });

      return NextResponse.json({
        hasSubscription: false,
        subscription: null,
        usage: buildUsageResponse(usageData, hasUnlimited, null, storedStatus),
        first_purchase_offer: firstPurchaseOffer,
      });
    }

    await updateSubscriptionInDB(admin, user.id, customerId, subscription, usageData);

    return NextResponse.json({
      hasSubscription: true,
      subscription: {
        id: subscription.id,
        status: subscription.status,
        cancel_at_period_end: subscription.cancel_at_period_end,
        current_period_end: subscription.current_period_end,
        current_period_start: subscription.current_period_start,
        // `paused` once a paused subscription's paid period has ended; the
        // client gates Pro features on this, not on `status`.
        effective_status: effectiveSubscriptionStatus(subscription),
        paused_until: pauseResumesAt(subscription),
        pause_paid_through: pausePaidThrough(subscription),
        has_discount: subscriptionHasDiscount(subscription),
        discount_coupon_id: appliedCouponId(subscription),
        items: subscription.items.data.map((item) => ({
          id: item.id,
          price: {
            id: item.price.id,
            unit_amount: item.price.unit_amount,
            currency: item.price.currency,
            recurring: item.price.recurring,
            lookup_key: item.price.lookup_key ?? null,
          },
        })),
      },
      usage: buildUsageResponse(usageData, hasUnlimited, subscription),
      // A Stripe subscription exists (live or in dunning): never a first purchase.
      first_purchase_offer: null,
    });
  } catch (error) {
    console.error('Error fetching subscription status:', error);
    captureServerExceptionAfterResponse(error, { route: 'api/subscription-status' });
    return NextResponse.json(
      { error: 'Failed to fetch subscription status' },
      { status: 500 }
    );
  }
}
