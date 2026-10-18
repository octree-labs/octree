-- AI edit credit packs.
--
-- A credit is one AI edit bought outside the plan allowance ($5 for 100).
-- Credits never expire and are only consumed once the free daily allowance
-- or the Pro monthly allowance is spent (lib/usage/allowance.ts decides).
--
--   * user_usage.edit_credits   the balance; written only by the service
--                               role (Stripe webhook via grant_credit_purchase)
--                               and consume_edit_credit.
--   * credit_purchases          one row per paid Checkout Session, unique on
--                               the session id so a redelivered webhook
--                               cannot grant twice. Service role only.
--   * consume_edit_credit       SECURITY DEFINER, self-only (same pattern as
--                               increment_edit_count after #395).
--   * add_edit_credits          SECURITY DEFINER, service role only: bumps the
--                               balance (creates the row if needed).
--   * grant_credit_purchase     SECURITY DEFINER, service role only: ledger
--                               row + add_edit_credits in ONE transaction, so a
--                               webhook retry can never leave a ledger row
--                               without its balance, or grant twice.
--
-- The user_usage guard trigger (20261018110000) is recreated here with
-- edit_credits added to the protected columns, so an `authenticated` session
-- can neither insert a row with credits nor change its own balance.
--
-- Versioned 20261018141000 because 20261018140000 is taken by
-- subscription_status_keeps_monthly_count (PR #400); the two are independent.
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
--
-- Same rules as 20261018110000_user_usage_column_guard.sql, restated as
-- column lists so that protecting a new column is a one-line change:
--
--   * protected_columns   only the service role (or a SECURITY DEFINER
--                         function owned by postgres) may set them. On INSERT
--                         they must carry the free-tier default (null, false,
--                         0 or 'inactive'); on UPDATE they must not change.
--                         Billing state and purchased balances go here
--                         (e.g. a future generation_credits).
--   * counter_columns     usage counters. On INSERT they must be 0; on UPDATE
--                         a user may only move them forward by at most one
--                         per statement (the API's optimistic +1). A future
--                         free_generations_used goes here.
--   * reset_date_columns  only the service role / definer functions may move.
--
-- To protect a new column, add its name to the right array below and to
-- supabase/tests/user_usage_column_guard.test.sql; nothing else changes.
-- ---------------------------------------------------------------------------

create or replace function public.user_usage_guard()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  protected_columns constant text[] := array[
    'is_pro',
    'subscription_status',
    'stripe_customer_id',
    'stripe_subscription_id',
    'current_period_start',
    'current_period_end',
    'cancel_at_period_end',
    'edit_credits'
  ];
  counter_columns constant text[] := array[
    'edit_count',
    'monthly_edit_count'
  ];
  reset_date_columns constant text[] := array[
    'monthly_reset_date',
    'daily_reset_date'
  ];
  privileged boolean;
  new_row jsonb;
  old_row jsonb;
  col text;
  v jsonb;
begin
  privileged :=
    coalesce(auth.role(), '') = 'service_role'
    or nullif(current_setting('request.jwt.claims', true), '') is null
    or current_user not in ('anon', 'authenticated');

  if privileged then
    return new;
  end if;

  new_row := to_jsonb(new);

  if tg_op = 'INSERT' then
    -- A user may create their own row only with the free-tier defaults.
    foreach col in array protected_columns || counter_columns loop
      v := new_row -> col;
      if v is not null
        and v <> 'null'::jsonb
        and v <> 'false'::jsonb
        and v <> '0'::jsonb
        and v <> '"inactive"'::jsonb
      then
        raise exception 'user_usage: billing and quota columns can only be set by the service role (%)', col
          using errcode = 'insufficient_privilege';
      end if;
    end loop;
    return new;
  end if;

  -- UPDATE
  old_row := to_jsonb(old);

  if new.id is distinct from old.id
    or new.user_id is distinct from old.user_id
  then
    raise exception 'user_usage: id and user_id are immutable'
      using errcode = 'insufficient_privilege';
  end if;

  foreach col in array protected_columns loop
    if new_row -> col is distinct from old_row -> col then
      raise exception 'user_usage: billing columns can only be changed by the service role (%)', col
        using errcode = 'insufficient_privilege';
    end if;
  end loop;

  -- Counters may only move forward, one edit per statement.
  foreach col in array counter_columns loop
    if (new_row ->> col)::bigint < (old_row ->> col)::bigint
      or (new_row ->> col)::bigint > (old_row ->> col)::bigint + 1
    then
      raise exception 'user_usage: quota counters can only be reset by the service role (%)', col
        using errcode = 'insufficient_privilege';
    end if;
  end loop;

  foreach col in array reset_date_columns loop
    if new_row -> col is distinct from old_row -> col then
      raise exception 'user_usage: quota reset dates can only be changed by the service role (%)', col
        using errcode = 'insufficient_privilege';
    end if;
  end loop;

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

-- Adds credits to a balance. Returns the new balance. The user_usage row is
-- created if the user has never used an AI edit. Service role only; the
-- webhook goes through grant_credit_purchase, this is the manual/support path.
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

-- Credits a paid Checkout Session: one ledger row, then the balance, in the
-- same transaction. Returns the new balance, or NULL when the session was
-- already credited (the ledger's unique session id is the idempotency guard,
-- so Stripe redeliveries and app retries are safe). Service role only.
create or replace function public.grant_credit_purchase(
  p_user_id uuid,
  p_checkout_session_id text,
  p_credits integer,
  p_amount_cents integer default 0,
  p_currency text default 'usd'
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_credits is null or p_credits <= 0 then
    raise exception 'grant_credit_purchase: p_credits must be positive';
  end if;
  if nullif(p_checkout_session_id, '') is null then
    raise exception 'grant_credit_purchase: p_checkout_session_id is required';
  end if;

  insert into public.credit_purchases (user_id, checkout_session_id, credits, amount_cents, currency)
  values (p_user_id, p_checkout_session_id, p_credits, coalesce(p_amount_cents, 0), coalesce(p_currency, 'usd'))
  on conflict (checkout_session_id) do nothing;

  if not found then
    return null; -- already granted
  end if;

  return public.add_edit_credits(p_user_id, p_credits);
end;
$$;

revoke execute on function public.grant_credit_purchase(uuid, text, integer, integer, text) from public, anon, authenticated;
grant execute on function public.grant_credit_purchase(uuid, text, integer, integer, text) to service_role;
