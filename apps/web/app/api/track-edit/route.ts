import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { hasUnlimitedEdits } from '@/lib/paywall';
import type { TablesInsert, TablesUpdate, Tables } from '@/database.types';
import { FREE_DAILY_EDIT_LIMIT, PRO_MONTHLY_EDIT_LIMIT } from '@/data/constants';

type UsageSlice = {
  edit_count: number;
  monthly_edit_count: number;
  daily_reset_date: string | null;
  monthly_reset_date: string | null;
  is_pro: boolean;
  subscription_status: string | null;
};

// GET handler to check edit limits without incrementing
export async function GET() {
  try {
    const supabase = await createClient();

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const hasUnlimitedUser = hasUnlimitedEdits(user.email);

    // Fetch user usage data
    const usageRes = await supabase
      .from('user_usage' as const)
      .select('edit_count, monthly_edit_count, daily_reset_date, monthly_reset_date, is_pro, subscription_status')
      .eq('user_id', user.id)
      .single();
    const usageData = usageRes.data as UsageSlice | null;
    const usageError = usageRes.error;

    // If no usage record exists, create one
    if (usageError && usageError.code === 'PGRST116') {
      const newUsagePayload: TablesInsert<'user_usage'> = {
        user_id: user.id,
        edit_count: 0,
        monthly_edit_count: 0,
        monthly_reset_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
        is_pro: hasUnlimitedUser,
        subscription_status: hasUnlimitedUser ? 'unlimited' : 'inactive',
      };

      const newUsageRes = await (
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        supabase.from('user_usage') as any
      )
        .insert(newUsagePayload)
        .select('edit_count, monthly_edit_count, monthly_reset_date, is_pro, subscription_status')
        .single();
      const newUsageData = newUsageRes.data as UsageSlice | null;
      const createError = newUsageRes.error;
      
      if (createError) {
        console.error('Error creating user_usage record:', createError);
        return NextResponse.json(
          { error: 'Failed to create usage record' },
          { status: 500 }
        );
      }

      return NextResponse.json({
        canEdit: true,
        editCount: 0,
        monthlyEditCount: 0,
        limit: hasUnlimitedUser ? null : FREE_DAILY_EDIT_LIMIT,
        monthlyLimit: hasUnlimitedUser ? null : PRO_MONTHLY_EDIT_LIMIT,
        isPro: hasUnlimitedUser,
        subscriptionStatus: hasUnlimitedUser ? 'unlimited' : 'inactive',
        monthlyResetDate: newUsageData?.monthly_reset_date ?? null,
        hasUnlimitedEdits: hasUnlimitedUser
      });
    }

    if (usageError) {
      console.error('Error fetching usage data:', usageError);
      return NextResponse.json(
        { error: 'Failed to fetch usage data' },
        { status: 500 }
      );
    }

    // Check if daily reset is needed for free users
    if (usageData && !usageData.is_pro && usageData.daily_reset_date) {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const dailyResetDate = new Date(usageData.daily_reset_date + 'T00:00:00');
      
      if (today > dailyResetDate) {
        // Reset daily count
        await (
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          supabase.from('user_usage') as any
        )
          .update({
            edit_count: 0,
            daily_reset_date: new Date().toISOString().split('T')[0],
          })
          .eq('user_id', user.id);
        
        usageData.edit_count = 0;
      }
    }

    // Check if monthly reset is needed for pro users
    if (usageData && usageData.is_pro && usageData.monthly_reset_date) {
      const resetDate = new Date(usageData.monthly_reset_date);
      const currentDate = new Date();
      
      if (currentDate >= resetDate) {
        // Reset monthly count
        const resetPayload: TablesUpdate<'user_usage'> = {
          monthly_edit_count: 0,
          monthly_reset_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
        };
        await (
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          supabase.from('user_usage') as any
        )
          .update(resetPayload)
          .eq('user_id', user.id);
        
        usageData.monthly_edit_count = 0;
      }
    }

    const editCount = usageData?.edit_count ?? 0;
    const monthlyEditCount = usageData?.monthly_edit_count ?? 0;
    const isPro = usageData?.is_pro || hasUnlimitedUser;
    const canEdit = hasUnlimitedUser || (isPro ? monthlyEditCount < PRO_MONTHLY_EDIT_LIMIT : editCount < FREE_DAILY_EDIT_LIMIT);

    return NextResponse.json({
      canEdit,
      editCount,
      monthlyEditCount,
      limit: hasUnlimitedUser || isPro ? null : FREE_DAILY_EDIT_LIMIT,
      monthlyLimit: isPro ? PRO_MONTHLY_EDIT_LIMIT : null,
      isPro,
      subscriptionStatus: usageData?.subscription_status ?? (hasUnlimitedUser ? 'unlimited' : 'inactive'),
      monthlyResetDate: usageData?.monthly_reset_date ?? null,
      hasUnlimitedEdits: hasUnlimitedUser
    });

  } catch (error) {
    console.error('Error fetching edit limits:', error);
    return NextResponse.json(
      { error: 'Failed to fetch edit limits' },
      { status: 500 }
    );
  }
}

export async function POST() {
  try {
    const supabase = await createClient();

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const hasUnlimitedUser = hasUnlimitedEdits(user.email);

    // First, ensure user has a usage record
    const initialRes = await supabase
      .from('user_usage' as const)
      .select('edit_count, monthly_edit_count, daily_reset_date, monthly_reset_date, is_pro, subscription_status')
      .eq('user_id', user.id)
      .single();
    let usageData = initialRes.data as UsageSlice | null;
    const usageError = initialRes.error;

    // If no usage record exists, create one
    if (usageError && usageError.code === 'PGRST116') {
      console.log('Creating new user_usage record for user:', user.id);
      
      const newUsagePayload: TablesInsert<'user_usage'> = {
        user_id: user.id,
        edit_count: 0,
        monthly_edit_count: 0,
        monthly_reset_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0], // 30 days from now
        is_pro: hasUnlimitedUser,
        subscription_status: hasUnlimitedUser ? 'unlimited' : 'inactive',
      };

      const newUsageRes = await (
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        supabase.from('user_usage') as any
      )
        .insert(newUsagePayload)
        .select('edit_count, monthly_edit_count, daily_reset_date, monthly_reset_date, is_pro, subscription_status')
        .single();
      const newUsageData = newUsageRes.data as UsageSlice | null;
      const createError = newUsageRes.error;
      
      if (createError) {
        console.error('Error creating user_usage record:', createError);
        return NextResponse.json(
          { error: 'Failed to create usage record' },
          { status: 500 }
        );
      }
      
      usageData = newUsageData;
    } else if (usageError) {
      console.error('Error fetching usage data:', usageError);
      return NextResponse.json(
        { error: 'Failed to fetch usage data' },
        { status: 500 }
      );
    }

    // Check if monthly reset is needed
    if (usageData && usageData.monthly_reset_date) {
      const resetDate = new Date(usageData.monthly_reset_date);
      const currentDate = new Date();
      
      if (currentDate >= resetDate) {
        // Reset monthly count
        const resetPayload: TablesUpdate<'user_usage'> = {
          monthly_edit_count: 0,
          monthly_reset_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
        };
        const resetRes = await (
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          supabase.from('user_usage') as any
        )
          .update(resetPayload)
          .eq('user_id', user.id);
        
        if (!resetRes.error && usageData) {
          usageData.monthly_edit_count = 0;
        }
      }
    }

    if (hasUnlimitedUser) {
      const updatePayload: TablesUpdate<'user_usage'> = {
        edit_count: (usageData?.edit_count ?? 0) + 1,
        monthly_edit_count: (usageData?.monthly_edit_count ?? 0) + 1,
        is_pro: true,
        subscription_status:
          usageData?.subscription_status === 'active'
            ? usageData.subscription_status
            : 'unlimited',
      };

      const unlimitedRes = await (
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        supabase.from('user_usage') as any
      )
        .update(updatePayload)
        .eq('user_id', user.id)
        .select('edit_count, monthly_edit_count, monthly_reset_date, is_pro, subscription_status')
        .single();

      if (unlimitedRes.error) {
        console.error('Error updating unlimited user usage data:', unlimitedRes.error);
        return NextResponse.json(
          { error: 'Failed to update usage data' },
          { status: 500 }
        );
      }

      const unlimitedUsageData = unlimitedRes.data as UsageSlice | null;

      return NextResponse.json({
        success: true,
        canEdit: true,
        remainingEdits: null,
        remainingMonthlyEdits: null,
        editCount: unlimitedUsageData?.edit_count ?? 0,
        monthlyEditCount: unlimitedUsageData?.monthly_edit_count ?? 0,
        isPro: true,
        subscriptionStatus:
          unlimitedUsageData?.subscription_status ??
          (usageData?.subscription_status === 'active'
            ? usageData.subscription_status
            : 'unlimited'),
        limitReached: false,
        monthlyLimitReached: false,
        monthlyResetDate:
          unlimitedUsageData?.monthly_reset_date ??
          usageData?.monthly_reset_date ??
          null,
        hasUnlimitedEdits: true
      });
    }

    // Call the database function to increment edit count and check limits
    const rpcArgs = { p_user_id: user.id } as const;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase.rpc('increment_edit_count', rpcArgs as any));

    if (error) {
      console.error('Error incrementing edit count:', error);
      return NextResponse.json(
        { error: 'Failed to track edit' },
        { status: 500 }
      );
    }

    // Get updated usage info
    const updatedRes = await supabase
      .from('user_usage' as const)
      .select('edit_count, monthly_edit_count, daily_reset_date, monthly_reset_date, is_pro, subscription_status')
      .eq('user_id', user.id)
      .single();
    // Cast via unknown to satisfy TS when nullable responses occur
    const updatedUsageData = (updatedRes.data as unknown) as UsageSlice;

    const canEdit = data as boolean;
    const remainingEdits = Math.max(0, FREE_DAILY_EDIT_LIMIT - updatedUsageData.edit_count);
    const remainingMonthlyEdits = Math.max(0, PRO_MONTHLY_EDIT_LIMIT - updatedUsageData.monthly_edit_count);

    return NextResponse.json({
      success: true,
      canEdit,
      remainingEdits,
      remainingMonthlyEdits,
      editCount: updatedUsageData.edit_count,
      monthlyEditCount: updatedUsageData.monthly_edit_count,
      isPro: updatedUsageData.is_pro,
      subscriptionStatus: updatedUsageData.subscription_status,
      limitReached: !canEdit,
      monthlyLimitReached: updatedUsageData.is_pro && updatedUsageData.monthly_edit_count >= PRO_MONTHLY_EDIT_LIMIT,
      monthlyResetDate: updatedUsageData.monthly_reset_date,
      hasUnlimitedEdits: false
    });

  } catch (error) {
    console.error('Error tracking edit:', error);
    return NextResponse.json(
      { error: 'Failed to track edit' },
      { status: 500 }
    );
  }
} 