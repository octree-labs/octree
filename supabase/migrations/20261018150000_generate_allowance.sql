-- Generate allowance: one free generation per account, then Pro or a $2.99
-- one-off credit (owner decision 2026-10-18; PostHog showed `paywall_shown
-- {feature: generate}` as the first wall new users hit, and they dismiss it).
--
-- * user_usage.free_generations_used  - 0 until the free generation is spent.
-- * user_usage.generation_credits     - bought through Stripe Checkout
--                                       (mode=payment), granted by the webhook.
-- * generation_purchases              - ledger of those purchases, unique per
--                                       Checkout Session so a retried webhook
--                                       cannot grant twice.
-- * consume_generation                - SECURITY DEFINER, self-only RPC (same
--                                       pattern as increment_edit_count) that
--                                       app/api/generate-document calls with
--                                       the user's own session.
-- * refund_generation                 - service-role only: hands a consumed
--                                       generation back when the model produced
--                                       nothing. Never callable by a user (the
--                                       'credit' refund is an unbounded +1).
-- * grant_generation_purchase         - service-role only, called by the
--                                       Stripe webhook: ledger row + balance in
--                                       ONE transaction, NULL when the session
--                                       was already credited.
-- * grant_generation_credits          - service-role only support path: bumps
--                                       the balance without a ledger row.
--
-- Both new columns are guarded twice: the shared user_usage guard trigger
-- (20261018110000_user_usage_column_guard.sql) is re-created below with them
-- added to its protected set, and a second trigger owned by this migration
-- alone (user_usage_generation_guard) protects just these two, so the result
-- does not depend on whether #401's re-creation of the shared guard runs
-- before or after this file. `authenticated` cannot PATCH them; only the
-- service role or the definer functions can move them.
--
-- Everything here is idempotent.

alter table public.user_usage
  add column if not exists free_generations_used integer not null default 0,
  add column if not exists generation_credits integer not null default 0;

alter table public.user_usage
  drop constraint if exists user_usage_free_generations_used_nonnegative;
alter table public.user_usage
  add constraint user_usage_free_generations_used_nonnegative check (free_generations_used >= 0);
alter table public.user_usage
  drop constraint if exists user_usage_generation_credits_nonnegative;
alter table public.user_usage
  add constraint user_usage_generation_credits_nonnegative check (generation_credits >= 0);

-- ---------------------------------------------------------------------------
-- Purchase ledger (service role only)
-- ---------------------------------------------------------------------------

create table if not exists public.generation_purchases (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  checkout_session_id text not null unique,
  credits integer not null check (credits > 0),
  amount_cents integer,
  currency text,
  created_at timestamptz not null default now()
);

create index if not exists generation_purchases_user_id_idx
  on public.generation_purchases (user_id);

alter table public.generation_purchases enable row level security;

revoke all on table public.generation_purchases from public, anon, authenticated;
grant all on table public.generation_purchases to service_role;

-- ---------------------------------------------------------------------------
-- Column guard: the #395 function with the protected columns as one array.
--
-- PR #401 (20261018141000_edit_credits.sql) re-creates this same function to
-- add `edit_credits`. Both migrations write the superset
-- (#395 columns + edit_credits + free_generations_used + generation_credits)
-- so whichever runs second leaves the trigger complete. `edit_credits` is
-- added here with IF NOT EXISTS only so the function compiles if this
-- migration runs first; #401 owns that column.
-- ---------------------------------------------------------------------------

alter table public.user_usage
  add column if not exists edit_credits integer not null default 0;

create or replace function public.user_usage_guard()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  privileged boolean;
  -- Columns the API roles may never change on UPDATE, and may only INSERT
  -- with the free-tier default below (or NULL).
  protected text[] := array[
    'is_pro',
    'subscription_status',
    'stripe_customer_id',
    'stripe_subscription_id',
    'current_period_start',
    'current_period_end',
    'cancel_at_period_end',
    'monthly_reset_date',
    'daily_reset_date',
    'edit_credits',
    'free_generations_used',
    'generation_credits'
  ];
  insert_defaults jsonb := jsonb_build_object(
    'is_pro', false,
    'subscription_status', 'inactive',
    'stripe_customer_id', null,
    'stripe_subscription_id', null,
    'current_period_start', null,
    'current_period_end', null,
    'cancel_at_period_end', false,
    'edit_credits', 0,
    'free_generations_used', 0,
    'generation_credits', 0
  );
  new_j jsonb := to_jsonb(new);
  old_j jsonb;
  col text;
begin
  privileged :=
    coalesce(auth.role(), '') = 'service_role'
    or nullif(current_setting('request.jwt.claims', true), '') is null
    or current_user not in ('anon', 'authenticated');

  if privileged then
    return new;
  end if;

  if tg_op = 'INSERT' then
    -- A user may create their own row only with the free-tier defaults
    -- (reset dates are left to their column defaults and not checked).
    foreach col in array protected loop
      if insert_defaults ? col
        and coalesce(new_j -> col, 'null'::jsonb) <> 'null'::jsonb
        and new_j -> col is distinct from insert_defaults -> col
      then
        raise exception 'user_usage: billing and quota columns can only be set by the service role'
          using errcode = 'insufficient_privilege';
      end if;
    end loop;
    if new.edit_count <> 0 or new.monthly_edit_count <> 0 then
      raise exception 'user_usage: billing and quota columns can only be set by the service role'
        using errcode = 'insufficient_privilege';
    end if;
    return new;
  end if;

  -- UPDATE
  old_j := to_jsonb(old);

  if new.id is distinct from old.id
    or new.user_id is distinct from old.user_id
  then
    raise exception 'user_usage: id and user_id are immutable'
      using errcode = 'insufficient_privilege';
  end if;

  foreach col in array protected loop
    if new_j -> col is distinct from old_j -> col then
      raise exception 'user_usage: % can only be changed by the service role', col
        using errcode = 'insufficient_privilege';
    end if;
  end loop;

  -- Counters may only move forward, one edit per statement.
  if new.edit_count < old.edit_count
    or new.edit_count > old.edit_count + 1
    or new.monthly_edit_count < old.monthly_edit_count
    or new.monthly_edit_count > old.monthly_edit_count + 1
  then
    raise exception 'user_usage: quota counters can only be reset by the service role'
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
-- Order-proof guard for the two allowance columns.
--
-- user_usage_guard above is shared with #401, and `create or replace` means
-- whichever of the two migrations runs LAST decides the protected set. If
-- #401's version is ever applied after this one (it merges later, or a push
-- uses --include-all) and it does not carry these two columns, they would be
-- writable from the user session again: PATCH generation_credits=999999.
-- This second trigger protects only free_generations_used and
-- generation_credits, is owned by this migration alone, and makes the result
-- independent of the order. Same trust rules as user_usage_guard.
-- ---------------------------------------------------------------------------

create or replace function public.user_usage_generation_guard()
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
    if coalesce(new.free_generations_used, 0) <> 0
      or coalesce(new.generation_credits, 0) <> 0
    then
      raise exception 'user_usage: billing and quota columns can only be set by the service role'
        using errcode = 'insufficient_privilege';
    end if;
    return new;
  end if;

  if new.free_generations_used is distinct from old.free_generations_used
    or new.generation_credits is distinct from old.generation_credits
  then
    raise exception 'user_usage: generation allowance can only be changed by the service role'
      using errcode = 'insufficient_privilege';
  end if;

  return new;
end;
$$;

drop trigger if exists user_usage_generation_guard on public.user_usage;
create trigger user_usage_generation_guard
  before insert or update on public.user_usage
  for each row execute function public.user_usage_generation_guard();

-- ---------------------------------------------------------------------------
-- consume_generation(p_user_id) -> 'pro' | 'free' | 'credit' | 'blocked'
--
-- Decision, in order:
--   is_pro                      -> 'pro'     (nothing changes)
--   free_generations_used = 0   -> 'free'    (free_generations_used := 1)
--   generation_credits > 0      -> 'credit'  (generation_credits -= 1)
--   otherwise                   -> 'blocked'
--
-- The row is locked (FOR UPDATE) so two concurrent requests cannot both spend
-- the same free generation or credit. A missing user_usage row is created
-- with the free-tier defaults so a brand-new account gets its free one.
-- ---------------------------------------------------------------------------

create or replace function public.consume_generation(p_user_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_is_pro boolean;
  v_free_used integer;
  v_credits integer;
begin
  -- API callers may only consume for themselves; the service role and direct
  -- SQL (no JWT) may act on anyone.
  if coalesce(auth.role(), '') <> 'service_role'
    and nullif(current_setting('request.jwt.claims', true), '') is not null
    and p_user_id is distinct from auth.uid()
  then
    raise exception 'consume_generation: callers may only consume their own allowance'
      using errcode = 'insufficient_privilege';
  end if;

  insert into public.user_usage (user_id)
  values (p_user_id)
  on conflict (user_id) do nothing;

  select is_pro, free_generations_used, generation_credits
  into v_is_pro, v_free_used, v_credits
  from public.user_usage
  where user_id = p_user_id
  for update;

  if coalesce(v_is_pro, false) then
    return 'pro';
  end if;

  if coalesce(v_free_used, 0) = 0 then
    update public.user_usage
    set free_generations_used = 1,
        updated_at = now()
    where user_id = p_user_id;
    return 'free';
  end if;

  if coalesce(v_credits, 0) > 0 then
    update public.user_usage
    set generation_credits = generation_credits - 1,
        updated_at = now()
    where user_id = p_user_id;
    return 'credit';
  end if;

  return 'blocked';
end;
$$;

revoke execute on function public.consume_generation(uuid) from public, anon;
grant execute on function public.consume_generation(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- refund_generation(p_user_id, p_kind)
--
-- Reverses one consume_generation when the generation never started (the
-- model call failed before any output). 'free' hands the free generation
-- back, 'credit' returns the credit; 'pro' and anything else are no-ops.
-- Returns true when a row was changed.
--
-- Service role only (app/api/generate-document calls it with the admin
-- client). It must never be executable by `authenticated`: a self-only
-- version would let any user POST /rest/v1/rpc/refund_generation in a loop
-- and mint credits ('credit' is +1 with no ceiling) or reset their free one.
-- ---------------------------------------------------------------------------

create or replace function public.refund_generation(p_user_id uuid, p_kind text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rows integer := 0;
begin
  if p_kind = 'free' then
    update public.user_usage
    set free_generations_used = 0,
        updated_at = now()
    where user_id = p_user_id
      and free_generations_used > 0;
    get diagnostics v_rows = row_count;
  elsif p_kind = 'credit' then
    update public.user_usage
    set generation_credits = generation_credits + 1,
        updated_at = now()
    where user_id = p_user_id;
    get diagnostics v_rows = row_count;
  end if;

  return v_rows > 0;
end;
$$;

revoke execute on function public.refund_generation(uuid, text) from public, anon, authenticated;
grant execute on function public.refund_generation(uuid, text) to service_role;

-- ---------------------------------------------------------------------------
-- grant_generation_credits(p_user_id, p_credits) -> new balance
--
-- Service role only. Creates the user_usage row if the buyer has never
-- loaded /api/subscription-status. The webhook goes through
-- grant_generation_purchase below; this is the manual / support path.
-- ---------------------------------------------------------------------------

create or replace function public.grant_generation_credits(p_user_id uuid, p_credits integer)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_balance integer;
begin
  if p_credits is null or p_credits <= 0 then
    raise exception 'grant_generation_credits: p_credits must be positive'
      using errcode = 'invalid_parameter_value';
  end if;

  insert into public.user_usage (user_id, generation_credits)
  values (p_user_id, p_credits)
  on conflict (user_id) do update
    set generation_credits = public.user_usage.generation_credits + excluded.generation_credits,
        updated_at = now()
  returning generation_credits into v_balance;

  return v_balance;
end;
$$;

revoke execute on function public.grant_generation_credits(uuid, integer) from public, anon, authenticated;
grant execute on function public.grant_generation_credits(uuid, integer) to service_role;

-- ---------------------------------------------------------------------------
-- grant_generation_purchase(p_user_id, p_checkout_session_id, p_credits,
--                           p_amount_cents, p_currency) -> new balance | NULL
--
-- Credits a paid Checkout Session: one generation_purchases row, then the
-- balance, in the same transaction. Returns NULL when the session was
-- already credited (the ledger's unique session id is the idempotency
-- guard), so a Stripe redelivery or an app retry after a 500 can neither
-- grant twice nor leave a ledger row without its balance. Service role only.
-- ---------------------------------------------------------------------------

create or replace function public.grant_generation_purchase(
  p_user_id uuid,
  p_checkout_session_id text,
  p_credits integer,
  p_amount_cents integer default null,
  p_currency text default null
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_credits is null or p_credits <= 0 then
    raise exception 'grant_generation_purchase: p_credits must be positive'
      using errcode = 'invalid_parameter_value';
  end if;
  if nullif(p_checkout_session_id, '') is null then
    raise exception 'grant_generation_purchase: p_checkout_session_id is required'
      using errcode = 'invalid_parameter_value';
  end if;

  insert into public.generation_purchases (user_id, checkout_session_id, credits, amount_cents, currency)
  values (p_user_id, p_checkout_session_id, p_credits, p_amount_cents, p_currency)
  on conflict (checkout_session_id) do nothing;

  if not found then
    return null; -- already granted
  end if;

  return public.grant_generation_credits(p_user_id, p_credits);
end;
$$;

revoke execute on function public.grant_generation_purchase(uuid, text, integer, integer, text) from public, anon, authenticated;
grant execute on function public.grant_generation_purchase(uuid, text, integer, integer, text) to service_role;
