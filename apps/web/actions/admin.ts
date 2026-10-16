'use server';

import { createClient } from '@supabase/supabase-js';
import { createClient as createServerClient } from '@/lib/supabase/server';
import { isAdminEmail } from '@/lib/admin';

// Use service role client for auth.users access
function getServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  return createClient(url, serviceKey);
}

async function requireAdmin() {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user || !isAdminEmail(user.email)) {
    throw new Error('Unauthorized');
  }
  return user;
}

// ─────────────────────────────────────────────────────────────────────────────
// Weekly signups (past 90 days)
// ─────────────────────────────────────────────────────────────────────────────
export interface WeeklySignup {
  signup_week: string;
  new_signups: number;
}

export async function getWeeklySignups(): Promise<WeeklySignup[]> {
  await requireAdmin();
  const supabase = getServiceClient();

  // Fetch ALL users with pagination
  const allUsers: { created_at: string }[] = [];
  let page = 1;
  const perPage = 1000;

  while (true) {
    const { data: authData, error: authError } = await supabase.auth.admin.listUsers({
      page,
      perPage,
    });

    if (authError || !authData) {
      console.error('getWeeklySignups error:', authError);
      break;
    }

    allUsers.push(...authData.users.map((u) => ({ created_at: u.created_at })));

    if (authData.users.length < perPage) {
      break;
    }
    page++;
  }

  const ninetyDaysAgo = new Date();
  ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

  const counts: Record<string, number> = {};

  for (const user of allUsers) {
    const createdAt = new Date(user.created_at);
    if (createdAt < ninetyDaysAgo) continue;

    // Get start of week (Monday)
    const weekStart = new Date(createdAt);
    const day = weekStart.getDay();
    const diff = weekStart.getDate() - day + (day === 0 ? -6 : 1);
    weekStart.setDate(diff);
    weekStart.setHours(0, 0, 0, 0);

    const key = weekStart.toISOString();
    counts[key] = (counts[key] || 0) + 1;
  }

  return Object.entries(counts)
    .map(([signup_week, new_signups]) => ({ signup_week, new_signups }))
    .sort((a, b) => new Date(b.signup_week).getTime() - new Date(a.signup_week).getTime());
}

// ─────────────────────────────────────────────────────────────────────────────
// Referral source breakdown
// ─────────────────────────────────────────────────────────────────────────────
export interface ReferralSource {
  referral_source: string | null;
  user_count: number;
}

export async function getReferralSources(): Promise<ReferralSource[]> {
  await requireAdmin();
  const supabase = getServiceClient();

  const { data, error } = await supabase
    .from('user_usage')
    .select('referral_source')
    .not('referral_source', 'is', null);

  if (error) {
    console.error('getReferralSources error:', error);
    return [];
  }

  // Aggregate in JS since we can't GROUP BY easily via PostgREST
  const counts: Record<string, number> = {};
  for (const row of data ?? []) {
    const src = row.referral_source ?? 'unknown';
    counts[src] = (counts[src] || 0) + 1;
  }

  return Object.entries(counts)
    .map(([referral_source, user_count]) => ({ referral_source, user_count }))
    .sort((a, b) => b.user_count - a.user_count);
}

// ─────────────────────────────────────────────────────────────────────────────
// Daily signups (all time)
// ─────────────────────────────────────────────────────────────────────────────
export interface DailySignup {
  signup_date: string;
  new_signups: number;
}

export async function getDailySignups(): Promise<DailySignup[]> {
  await requireAdmin();
  const supabase = getServiceClient();

  // Fetch ALL users with pagination
  const allUsers: { created_at: string }[] = [];
  let page = 1;
  const perPage = 1000;

  while (true) {
    const { data: authData, error: authError } = await supabase.auth.admin.listUsers({
      page,
      perPage,
    });

    if (authError || !authData) {
      console.error('getDailySignups error:', authError);
      break;
    }

    allUsers.push(...authData.users.map((u) => ({ created_at: u.created_at })));

    // If we got fewer than perPage, we've reached the end
    if (authData.users.length < perPage) {
      break;
    }
    page++;
  }

  if (allUsers.length === 0) {
    return [];
  }

  // Find the earliest signup date
  let earliestDate = new Date();
  for (const user of allUsers) {
    const createdAt = new Date(user.created_at);
    if (createdAt < earliestDate) {
      earliestDate = createdAt;
    }
  }

  // Start from the earliest date
  earliestDate.setHours(0, 0, 0, 0);

  const counts: Record<string, number> = {};

  // Initialize all days from earliest to today to 0
  for (let d = new Date(earliestDate); d <= new Date(); d.setDate(d.getDate() + 1)) {
    const key = d.toISOString().split('T')[0];
    counts[key] = 0;
  }

  for (const user of allUsers) {
    const createdAt = new Date(user.created_at);
    const key = createdAt.toISOString().split('T')[0];
    counts[key] = (counts[key] || 0) + 1;
  }

  return Object.entries(counts)
    .map(([signup_date, new_signups]) => ({ signup_date, new_signups }))
    .sort((a, b) => new Date(a.signup_date).getTime() - new Date(b.signup_date).getTime());
}

// ─────────────────────────────────────────────────────────────────────────────
// Pro subscribers list
// ─────────────────────────────────────────────────────────────────────────────
export interface ProSubscriber {
  user_id: string;
  email: string;
  is_pro: boolean;
  subscription_status: string | null;
  current_period_end: string | null;
}

export async function getProSubscribers(): Promise<ProSubscriber[]> {
  await requireAdmin();
  const supabase = getServiceClient();

  // Get user_usage rows that are pro or have active subscription
  const { data: usageData, error: usageError } = await supabase
    .from('user_usage')
    .select('user_id, is_pro, subscription_status, current_period_end')
    .or(
      'is_pro.eq.true,and(subscription_status.in.(active,trialing),current_period_end.gt.now())'
    )
    .order('updated_at', { ascending: false });

  if (usageError || !usageData) {
    console.error('getProSubscribers usage error:', usageError);
    return [];
  }

  // Fetch ALL users with pagination to build email map
  const emailMap = new Map<string, string>();
  let page = 1;
  const perPage = 1000;

  while (true) {
    const { data: authData, error: authError } = await supabase.auth.admin.listUsers({
      page,
      perPage,
    });

    if (authError || !authData) {
      console.error('getProSubscribers auth error:', authError);
      break;
    }

    for (const u of authData.users) {
      emailMap.set(u.id, u.email ?? '');
    }

    if (authData.users.length < perPage) {
      break;
    }
    page++;
  }

  const userIds = usageData.map((u) => u.user_id);

  return usageData
    .filter((u) => userIds.includes(u.user_id))
    .map((u) => ({
      user_id: u.user_id,
      email: emailMap.get(u.user_id) ?? '',
      is_pro: u.is_pro,
      subscription_status: u.subscription_status,
      current_period_end: u.current_period_end,
    }));
}

// ─────────────────────────────────────────────────────────────────────────────
// All users list (for daily progress table)
// ─────────────────────────────────────────────────────────────────────────────
export interface UserRow {
  id: string;
  email: string;
  referral_source: string | null;
  signup_date: string;
}

export async function getAllUsers(): Promise<UserRow[]> {
  await requireAdmin();
  const supabase = getServiceClient();

  // Fetch ALL users with pagination
  const allUsers: { id: string; email: string; created_at: string }[] = [];
  let page = 1;
  const perPage = 1000;

  while (true) {
    const { data: authData, error: authError } = await supabase.auth.admin.listUsers({
      page,
      perPage,
    });

    if (authError || !authData) {
      console.error('getAllUsers auth error:', authError);
      break;
    }

    allUsers.push(
      ...authData.users.map((u) => ({
        id: u.id,
        email: u.email ?? '',
        created_at: u.created_at,
      }))
    );

    if (authData.users.length < perPage) {
      break;
    }
    page++;
  }

  // Fetch referral sources
  const { data: usageData } = await supabase.from('user_usage').select('user_id, referral_source');

  const refMap = new Map<string, string | null>();
  for (const u of usageData ?? []) {
    refMap.set(u.user_id, u.referral_source);
  }

  return allUsers
    .map((u) => ({
      id: u.id,
      email: u.email,
      referral_source: refMap.get(u.id) ?? null,
      signup_date: u.created_at,
    }))
    .sort((a, b) => new Date(b.signup_date).getTime() - new Date(a.signup_date).getTime());
}

