import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { captureServerExceptionAfterResponse } from '@/lib/posthog-server';
import type Stripe from 'stripe';
import { stripe } from '@/lib/stripe';
import { hasUnlimitedEdits } from '@/lib/paywall';
import { resolveStripeCustomer } from '@/lib/stripe-customer';
import {
  appliedCouponId,
  effectiveSubscriptionStatus,
  pausePaidThrough,
  pauseResumesAt,
  subscriptionHasDiscount,
} from '@/lib/stripe-subscription';
import type { Tables } from '@/database.types';
import {
  FREE_DAILY_EDIT_LIMIT,
  PRO_MONTHLY_EDIT_LIMIT,
} from '@/data/constants';

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

async function findStripeCustomerId(
  supabase: any,
  user: { id: string; email?: string | null }
): Promise<string | null> {
  try {
    const resolved = await resolveStripeCustomer(supabase, user);
    return resolved?.customerId ?? null;
  } catch (error) {
    console.error('Error fetching Stripe customer:', error);
    return null;
  }
}

async function findActiveSubscription(
  customerId: string
): Promise<Stripe.Subscription | null> {
  const activeSubs = await stripe.subscriptions.list({
    customer: customerId,
    status: 'active',
    limit: 1,
  });

  if (activeSubs.data[0]) return activeSubs.data[0];

  const trialSubs = await stripe.subscriptions.list({
    customer: customerId,
    status: 'trialing',
    limit: 1,
  });

  return trialSubs.data[0] || null;
}

function buildUsageResponse(
  usageData: Tables<'user_usage'> | null,
  hasUnlimited: boolean,
  subscription?: Stripe.Subscription | null
) {
  const editCount = usageData?.edit_count || 0;
  const monthlyEditCount = usageData?.monthly_edit_count || 0;
  // Paused collection reads as the free tier once the paid period has ended
  // (see lib/stripe-subscription.ts). `usageData.is_pro` was read before the
  // RPC below rewrote it, so it must not be trusted for a paused subscription.
  const effectiveStatus = subscription ? effectiveSubscriptionStatus(subscription) : null;
  const isActive = effectiveStatus === 'active';
  const isPaused = effectiveStatus === 'paused';

  const baseRemainingEdits = isActive
    ? Math.max(0, PRO_MONTHLY_EDIT_LIMIT - monthlyEditCount)
    : Math.max(0, FREE_DAILY_EDIT_LIMIT - editCount);

  return {
    editCount,
    monthlyEditCount,
    remainingEdits: hasUnlimited ? null : baseRemainingEdits,
    remainingMonthlyEdits: hasUnlimited
      ? null
      : isActive
        ? baseRemainingEdits
        : 0,
    isPro: isActive || hasUnlimited || (!isPaused && Boolean(usageData?.is_pro)),
    limitReached: hasUnlimited
      ? false
      : isActive
        ? monthlyEditCount >= PRO_MONTHLY_EDIT_LIMIT
        : editCount >= FREE_DAILY_EDIT_LIMIT,
    monthlyLimitReached: hasUnlimited
      ? false
      : isActive
        ? monthlyEditCount >= PRO_MONTHLY_EDIT_LIMIT
        : false,
    monthlyResetDate: usageData?.monthly_reset_date || null,
    hasUnlimitedEdits: hasUnlimited,
  };
}

async function updateSubscriptionInDB(
  admin: any,
  userId: string,
  customerId: string,
  subscription: Stripe.Subscription
) {
  try {
    // EXECUTE on this function is revoked from `authenticated`; only the
    // service role may call it.
    const { error } = await admin.rpc('update_user_subscription_status', {
      p_user_id: userId,
      p_stripe_customer_id: customerId,
      p_stripe_subscription_id: subscription.id,
      // `paused` (not Stripe's `active`) so the RPC derives is_pro = false
      // while collection is paused, matching the webhook.
      p_subscription_status: effectiveSubscriptionStatus(subscription),
      p_current_period_start: new Date(
        subscription.current_period_start * 1000
      ).toISOString(),
      p_current_period_end: new Date(
        subscription.current_period_end * 1000
      ).toISOString(),
      p_cancel_at_period_end: subscription.cancel_at_period_end,
    });
    if (error) {
      console.error('Error updating subscription status in database:', error);
    }
  } catch (error) {
    console.error('Error updating subscription status in database:', error);
  }
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

    const customerId = await findStripeCustomerId(supabase, user);
    if (!customerId) {
      return NextResponse.json({
        hasSubscription: false,
        subscription: null,
        usage: buildUsageResponse(usageData, hasUnlimited),
      });
    }

    const subscription = await findActiveSubscription(customerId);
    if (!subscription) {
      return NextResponse.json({
        hasSubscription: false,
        subscription: null,
        usage: buildUsageResponse(usageData, hasUnlimited),
      });
    }

    await updateSubscriptionInDB(admin, user.id, customerId, subscription);

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
          },
        })),
      },
      usage: buildUsageResponse(usageData, hasUnlimited, subscription),
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
