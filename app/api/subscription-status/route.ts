import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import type Stripe from 'stripe';
import { stripe } from '@/lib/stripe';
import { hasUnlimitedEdits } from '@/lib/paywall';
import type { Tables } from '@/database.types';
import {
  FREE_DAILY_EDIT_LIMIT,
  PRO_MONTHLY_EDIT_LIMIT,
} from '@/data/constants';

function getResetDate(): string {
  return new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
    .toISOString()
    .split('T')[0];
}

async function getOrCreateUsageData(
  supabase: any,
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
    const { data, error } = await supabase
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
  supabase: any,
  userId: string,
  usageData: Tables<'user_usage'>
): Promise<Tables<'user_usage'>> {
  if (!usageData.monthly_reset_date) return usageData;

  const resetDate = new Date(usageData.monthly_reset_date);
  if (new Date() < resetDate) return usageData;

  const { error } = await supabase
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
  supabase: any,
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

  const { data, error } = await supabase
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

async function findStripeCustomer(
  email: string,
  userId: string
): Promise<Stripe.Customer | null> {
  try {
    const customers = await stripe.customers.list({ email, limit: 1 });
    if (customers.data[0]) return customers.data[0];

    const allCustomers = await stripe.customers.list({ limit: 100 });
    return (
      allCustomers.data.find(
        (c) =>
          c.metadata?.user_id === userId ||
          c.metadata?.supabase_user_id === userId
      ) || null
    );
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
  const isActive = subscription?.status === 'active';

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
    isPro: isActive || hasUnlimited || usageData?.is_pro || false,
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
  supabase: any,
  userId: string,
  customerId: string,
  subscription: Stripe.Subscription
) {
  try {
    await supabase.rpc('update_user_subscription_status', {
      p_user_id: userId,
      p_stripe_customer_id: customerId,
      p_stripe_subscription_id: subscription.id,
      p_subscription_status: subscription.status,
      p_current_period_start: new Date(
        subscription.current_period_start * 1000
      ).toISOString(),
      p_current_period_end: new Date(
        subscription.current_period_end * 1000
      ).toISOString(),
      p_cancel_at_period_end: subscription.cancel_at_period_end,
    });
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

    let usageData = await getOrCreateUsageData(supabase, user.id, hasUnlimited);
    if (!usageData) {
      return NextResponse.json(
        { error: 'Failed to get usage data' },
        { status: 500 }
      );
    }

    usageData = await handleMonthlyReset(supabase, user.id, usageData);

    if (hasUnlimited) {
      usageData = await ensureUnlimitedStatus(supabase, user.id, usageData);
    }

    const customer = await findStripeCustomer(user.email!, user.id);
    if (!customer) {
      return NextResponse.json({
        hasSubscription: false,
        subscription: null,
        usage: buildUsageResponse(usageData, hasUnlimited),
      });
    }

    const subscription = await findActiveSubscription(customer.id);
    if (!subscription) {
      return NextResponse.json({
        hasSubscription: false,
        subscription: null,
        usage: buildUsageResponse(usageData, hasUnlimited),
      });
    }

    await updateSubscriptionInDB(supabase, user.id, customer.id, subscription);

    return NextResponse.json({
      hasSubscription: true,
      subscription: {
        id: subscription.id,
        status: subscription.status,
        cancel_at_period_end: subscription.cancel_at_period_end,
        current_period_end: subscription.current_period_end,
        current_period_start: subscription.current_period_start,
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
    return NextResponse.json(
      { error: 'Failed to fetch subscription status' },
      { status: 500 }
    );
  }
}
