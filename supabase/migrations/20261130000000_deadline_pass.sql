-- Deadline Pass: a one-off purchase of 7 days of Pro (no subscription).
--
-- * user_usage.pro_until: Pro is on while pro_until > now(), whatever the
--   subscription columns say. It is never written by the subscription
--   paths (webhook, update_user_subscription_status, the status-route
--   self-heal), so a pass survives a subscription being revoked and a
--   subscription survives a pass running out. is_pro stays the
--   subscription cache it always was.
-- * pro_pass_purchases: the ledger, one row per Checkout Session (unique),
--   the idempotency guard of grant_pro_pass, exactly like credit_purchases
--   and generation_purchases.
-- * grant_pro_pass(): ledger row + pro_until in ONE transaction. Stacks:
--   a pass bought while one is still running extends it by `p_days` from
--   its current end, not from now. Marks onboarding_completed (like a paid
--   subscription does in the webhook). Returns the new pro_until, or NULL
--   when the session was already granted (a Stripe redelivery, or the
--   /success page and the webhook both granting).
-- * increment_edit_count / consume_generation: an active pass counts as
--   Pro (the monthly Pro allowance of 500 AI edits and unlimited
--   generations), the same rule as lib/subscription/entitlement.ts.
--   A pass uses the same monthly Pro counter as a subscription, so buying
--   several passes in one month does not multiply the allowance.
-- * user_usage_pro_until_guard: the API roles can never write pro_until
--   (own trigger, so it holds whatever order the user_usage_guard
--   re-definitions run in).
--
-- Idempotent. Apply BEFORE deploying the app code that selects pro_until.

alter table public.user_usage
  add column if not exists pro_until timestamptz;

create table if not exists public.pro_pass_purchases (
  id bigserial primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  checkout_session_id text not null unique,
  days integer not null check (days > 0),
  amount_cents integer,
  currency text,
  pro_until_before timestamptz,
  pro_until_after timestamptz not null,
  created_at timestamptz not null default now()
);

create index if not exists pro_pass_purchases_user_id_idx
  on public.pro_pass_purchases (user_id);

alter table public.pro_pass_purchases enable row level security;

revoke all on table public.pro_pass_purchases from public, anon, authenticated;
grant all on table public.pro_pass_purchases to service_role;
grant usage, select on sequence public.pro_pass_purchases_id_seq to service_role;

-- ---------------------------------------------------------------------------
-- Column guard for pro_until (same trust rules as user_usage_guard).
-- ---------------------------------------------------------------------------

create or replace function public.user_usage_pro_until_guard()
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
    if new.pro_until is not null then
      raise exception 'user_usage: pro_until can only be set by the service role'
        using errcode = 'insufficient_privilege';
    end if;
    return new;
  end if;

  if new.pro_until is distinct from old.pro_until then
    raise exception 'user_usage: pro_until can only be changed by the service role'
      using errcode = 'insufficient_privilege';
  end if;

  return new;
end;
$$;

drop trigger if exists user_usage_pro_until_guard on public.user_usage;
create trigger user_usage_pro_until_guard
  before insert or update on public.user_usage
  for each row execute function public.user_usage_pro_until_guard();

-- ---------------------------------------------------------------------------
-- grant_pro_pass(user, session, days, amount, currency) -> new pro_until | null
-- ---------------------------------------------------------------------------

create or replace function public.grant_pro_pass(
  p_user_id uuid,
  p_checkout_session_id text,
  p_days integer,
  p_amount_cents integer default null,
  p_currency text default null
)
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare
  v_before timestamptz;
  v_after timestamptz;
begin
  if p_days is null or p_days <= 0 or p_days > 366 then
    raise exception 'grant_pro_pass: p_days must be between 1 and 366'
      using errcode = 'invalid_parameter_value';
  end if;
  if nullif(p_checkout_session_id, '') is null then
    raise exception 'grant_pro_pass: p_checkout_session_id is required'
      using errcode = 'invalid_parameter_value';
  end if;

  -- A buyer without a usage row yet (should not happen: onboarding creates
  -- it) still gets their pass.
  insert into public.user_usage (user_id)
  values (p_user_id)
  on conflict (user_id) do nothing;

  -- Lock the row first so two grants for different sessions stack in order.
  select pro_until into v_before
  from public.user_usage
  where user_id = p_user_id
  for update;

  if exists (select 1 from public.pro_pass_purchases where checkout_session_id = p_checkout_session_id) then
    return null; -- already granted
  end if;

  v_after := greatest(coalesce(v_before, now()), now()) + make_interval(days => p_days);

  insert into public.pro_pass_purchases (
    user_id, checkout_session_id, days, amount_cents, currency, pro_until_before, pro_until_after
  )
  values (
    p_user_id, p_checkout_session_id, p_days, p_amount_cents, p_currency, v_before, v_after
  )
  on conflict (checkout_session_id) do nothing;

  if not found then
    return null; -- a concurrent grant of the same session won
  end if;

  update public.user_usage
  set pro_until = v_after,
      onboarding_completed = true,
      updated_at = now()
  where user_id = p_user_id;

  return v_after;
end;
$$;

revoke execute on function public.grant_pro_pass(uuid, text, integer, integer, text) from public, anon, authenticated;
grant execute on function public.grant_pro_pass(uuid, text, integer, integer, text) to service_role;

-- ---------------------------------------------------------------------------
-- increment_edit_count: 20261018110000's version with the pass counted as Pro.
-- ---------------------------------------------------------------------------

create or replace function public.increment_edit_count(p_user_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
DECLARE
  current_edit_count INTEGER;
  current_monthly_count INTEGER;
  current_daily_reset DATE;
  user_monthly_reset DATE;
  is_pro_user BOOLEAN;
  max_free_daily_edits INTEGER := 5;
  max_pro_monthly_edits INTEGER := 500;
BEGIN
  -- API callers may only increment themselves; the service role and direct
  -- SQL (no JWT) may increment anyone.
  IF coalesce(auth.role(), '') <> 'service_role'
    AND nullif(current_setting('request.jwt.claims', true), '') IS NOT NULL
    AND p_user_id IS DISTINCT FROM auth.uid()
  THEN
    RAISE EXCEPTION 'increment_edit_count: callers may only increment their own usage'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT edit_count, monthly_edit_count, daily_reset_date, monthly_reset_date,
         coalesce(is_pro, false) OR coalesce(pro_until > now(), false)
  INTO current_edit_count, current_monthly_count, current_daily_reset, user_monthly_reset, is_pro_user
  FROM public.user_usage
  WHERE user_id = p_user_id;

  IF is_pro_user THEN
    IF CURRENT_DATE >= user_monthly_reset THEN
      UPDATE public.user_usage
      SET
        monthly_edit_count = 0,
        monthly_reset_date = (CURRENT_DATE + INTERVAL '1 month')::date,
        updated_at = now()
      WHERE user_id = p_user_id;

      current_monthly_count := 0;
    END IF;

    IF current_monthly_count >= max_pro_monthly_edits THEN
      RETURN FALSE;
    END IF;

    UPDATE public.user_usage
    SET
      monthly_edit_count = monthly_edit_count + 1,
      updated_at = now()
    WHERE user_id = p_user_id;
  ELSE
    IF CURRENT_DATE > current_daily_reset THEN
      UPDATE public.user_usage
      SET
        edit_count = 0,
        daily_reset_date = CURRENT_DATE,
        updated_at = now()
      WHERE user_id = p_user_id;

      current_edit_count := 0;
    END IF;

    IF current_edit_count >= max_free_daily_edits THEN
      RETURN FALSE;
    END IF;

    UPDATE public.user_usage
    SET
      edit_count = edit_count + 1,
      updated_at = now()
    WHERE user_id = p_user_id;
  END IF;

  RETURN TRUE;
END;
$$;

revoke execute on function public.increment_edit_count(uuid) from public, anon;
grant execute on function public.increment_edit_count(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- consume_generation: 20261018150000's version with the pass counted as Pro.
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

  select coalesce(is_pro, false) or coalesce(pro_until > now(), false),
         free_generations_used, generation_credits
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
