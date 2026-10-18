-- AI edit credit packs.
--
-- A credit is one AI edit bought outside the plan allowance ($5 for 100).
-- Credits never expire and are only consumed once the free daily allowance
-- or the Pro monthly allowance is spent (lib/usage/allowance.ts decides).
--
--   * user_usage.edit_credits   the balance; written only by the service
--                               role (Stripe webhook via add_edit_credits)
--                               and consume_edit_credit.
--   * credit_purchases          one row per paid Checkout Session, unique on
--                               the session id so a redelivered webhook
--                               cannot grant twice. Service role only.
--   * consume_edit_credit       SECURITY DEFINER, self-only (same pattern as
--                               increment_edit_count after #395).
--   * add_edit_credits          SECURITY DEFINER, service role only.
--
-- The user_usage guard trigger (20261018110000) is recreated here with
-- edit_credits added to the protected columns, so an `authenticated` session
-- can neither insert a row with credits nor change its own balance.
--
-- Everything here is idempotent.

alter table public.user_usage
  add column if not exists edit_credits integer not null default 0;

alter table public.user_usage
  drop constraint if exists user_usage_edit_credits_nonnegative;
alter table public.user_usage
  add constraint user_usage_edit_credits_nonnegative check (edit_credits >= 0);

-- ---------------------------------------------------------------------------
-- Guard trigger: protect edit_credits like the billing columns.
-- ---------------------------------------------------------------------------

create or replace function public.user_usage_guard()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  privileged boolean;
begin
  privileged :=
    coalesce(auth.role(), '') = 'service_role'
    or nullif(current_setting('request.jwt.claims', true), '') is null
    or current_user not in ('anon', 'authenticated');

  if privileged then
    return new;
  end if;

  if tg_op = 'INSERT' then
    -- A user may create their own row only with the free-tier defaults.
    if new.is_pro
      or coalesce(new.subscription_status, 'inactive') <> 'inactive'
      or new.stripe_customer_id is not null
      or new.stripe_subscription_id is not null
      or new.current_period_start is not null
      or new.current_period_end is not null
      or coalesce(new.cancel_at_period_end, false)
      or new.edit_count <> 0
      or new.monthly_edit_count <> 0
      or new.edit_credits <> 0
    then
      raise exception 'user_usage: billing and quota columns can only be set by the service role'
        using errcode = 'insufficient_privilege';
    end if;
    return new;
  end if;

  -- UPDATE
  if new.id is distinct from old.id
    or new.user_id is distinct from old.user_id
  then
    raise exception 'user_usage: id and user_id are immutable'
      using errcode = 'insufficient_privilege';
  end if;

  if new.is_pro is distinct from old.is_pro
    or new.subscription_status is distinct from old.subscription_status
    or new.stripe_customer_id is distinct from old.stripe_customer_id
    or new.stripe_subscription_id is distinct from old.stripe_subscription_id
    or new.current_period_start is distinct from old.current_period_start
    or new.current_period_end is distinct from old.current_period_end
    or new.cancel_at_period_end is distinct from old.cancel_at_period_end
    or new.edit_credits is distinct from old.edit_credits
  then
    raise exception 'user_usage: billing columns can only be changed by the service role'
      using errcode = 'insufficient_privilege';
  end if;

  -- Counters may only move forward, one edit per statement.
  if new.edit_count < old.edit_count
    or new.edit_count > old.edit_count + 1
    or new.monthly_edit_count < old.monthly_edit_count
    or new.monthly_edit_count > old.monthly_edit_count + 1
  then
    raise exception 'user_usage: quota counters can only be reset by the service role'
      using errcode = 'insufficient_privilege';
  end if;

  if new.monthly_reset_date is distinct from old.monthly_reset_date
    or new.daily_reset_date is distinct from old.daily_reset_date
  then
    raise exception 'user_usage: quota reset dates can only be changed by the service role'
      using errcode = 'insufficient_privilege';
  end if;

  return new;
end;
$$;

drop trigger if exists user_usage_guard on public.user_usage;
create trigger user_usage_guard
  before insert or update on public.user_usage
  for each row execute function public.user_usage_guard();

-- ---------------------------------------------------------------------------
-- Ledger
-- ---------------------------------------------------------------------------

create table if not exists public.credit_purchases (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  checkout_session_id text not null unique,
  credits integer not null check (credits > 0),
  amount_cents integer not null default 0,
  currency text not null default 'usd',
  created_at timestamptz not null default now()
);

create index if not exists credit_purchases_user_id_idx
  on public.credit_purchases (user_id, created_at desc);

alter table public.credit_purchases enable row level security;

-- No policies: only the service role (which bypasses RLS) reads or writes.
revoke all on table public.credit_purchases from public, anon, authenticated;
grant all on table public.credit_purchases to service_role;

-- ---------------------------------------------------------------------------
-- Functions
-- ---------------------------------------------------------------------------

-- Spends one credit. Returns true when a credit was consumed, false when the
-- balance was already zero (or the row does not exist). API callers may only
-- spend their own; the service role and direct SQL may spend anyone's.
create or replace function public.consume_edit_credit(p_user_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(auth.role(), '') <> 'service_role'
    and nullif(current_setting('request.jwt.claims', true), '') is not null
    and p_user_id is distinct from auth.uid()
  then
    raise exception 'consume_edit_credit: callers may only spend their own credits'
      using errcode = 'insufficient_privilege';
  end if;

  update public.user_usage
  set
    edit_credits = edit_credits - 1,
    updated_at = now()
  where user_id = p_user_id
    and edit_credits > 0;

  return found;
end;
$$;

revoke execute on function public.consume_edit_credit(uuid) from public, anon;
grant execute on function public.consume_edit_credit(uuid) to authenticated, service_role;

-- Adds credits after a paid Checkout Session. Returns the new balance. The
-- user_usage row is created if the user has never used an AI edit.
create or replace function public.add_edit_credits(p_user_id uuid, p_credits integer)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  new_balance integer;
begin
  if p_credits is null or p_credits <= 0 then
    raise exception 'add_edit_credits: p_credits must be positive';
  end if;

  insert into public.user_usage (user_id, edit_credits)
  values (p_user_id, p_credits)
  on conflict (user_id) do update
    set edit_credits = public.user_usage.edit_credits + excluded.edit_credits,
        updated_at = now()
  returning edit_credits into new_balance;

  return new_balance;
end;
$$;

revoke execute on function public.add_edit_credits(uuid, integer) from public, anon, authenticated;
grant execute on function public.add_edit_credits(uuid, integer) to service_role;
