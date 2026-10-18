-- Column guard for public.user_usage.
--
-- The baseline gives user_usage an UPDATE policy of `USING (auth.uid() = user_id)`
-- plus `GRANT ALL ... TO authenticated`, so any signed-in user could
-- `PATCH /rest/v1/user_usage?user_id=eq.<self>` with `{"is_pro": true}` or
-- `{"edit_count": 0}` and every server-side gate (octra-agent, track-edit,
-- paywall checks) would believe it. RLS cannot restrict individual columns, so
-- a BEFORE trigger does it instead.
--
-- Who is trusted:
--   * the service role (Stripe webhook, usage routes via the admin client);
--   * statements with no JWT at all (psql, migrations, the auth-admin trigger
--     that calls handle_new_user on signup);
--   * statements running inside a SECURITY DEFINER function owned by postgres
--     (increment_edit_count, update_user_subscription_status). Inside such a
--     function `current_user` is the owner, not the API role, which is why the
--     trigger function itself is SECURITY INVOKER: a definer trigger would see
--     its own owner for every caller and could not tell the two apart.
-- Everyone else (the `anon` / `authenticated` API roles) may only touch the
-- profile columns: referral_source, role, use_case, onboarding_completed.
--
-- Everything here is idempotent.

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

-- update_user_subscription_status is SECURITY DEFINER and was executable by
-- anon and authenticated, which is a second route to `is_pro = true` for any
-- user id. Only the service role (app/api/subscription-status via the admin
-- client) may call it.
revoke execute on function public.update_user_subscription_status(uuid, text, text, text, timestamptz, timestamptz, boolean)
  from public, anon, authenticated;
grant execute on function public.update_user_subscription_status(uuid, text, text, text, timestamptz, timestamptz, boolean)
  to service_role;

-- increment_edit_count stays the counter path for signed-in users (it is
-- SECURITY DEFINER, so its resets pass the guard), but it must only move the
-- caller's own row: before, any user could burn another user's quota.
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

  -- Get current usage
  SELECT edit_count, monthly_edit_count, daily_reset_date, monthly_reset_date, is_pro
  INTO current_edit_count, current_monthly_count, current_daily_reset, user_monthly_reset, is_pro_user
  FROM public.user_usage
  WHERE user_id = p_user_id;

  -- If user is pro, check monthly reset and limit
  IF is_pro_user THEN
    -- Check if monthly reset is needed
    IF CURRENT_DATE >= user_monthly_reset THEN
      UPDATE public.user_usage
      SET
        monthly_edit_count = 0,
        monthly_reset_date = (CURRENT_DATE + INTERVAL '1 month')::date,
        updated_at = now()
      WHERE user_id = p_user_id;

      current_monthly_count := 0;
    END IF;

    -- Check monthly limit
    IF current_monthly_count >= max_pro_monthly_edits THEN
      RETURN FALSE; -- Monthly limit reached
    END IF;

    -- Increment monthly count
    UPDATE public.user_usage
    SET
      monthly_edit_count = monthly_edit_count + 1,
      updated_at = now()
    WHERE user_id = p_user_id;
  ELSE
    -- Free user: check daily reset and limit
    -- Check if daily reset is needed
    IF CURRENT_DATE > current_daily_reset THEN
      UPDATE public.user_usage
      SET
        edit_count = 0,
        daily_reset_date = CURRENT_DATE,
        updated_at = now()
      WHERE user_id = p_user_id;

      current_edit_count := 0;
    END IF;

    -- Check daily limit
    IF current_edit_count >= max_free_daily_edits THEN
      RETURN FALSE; -- Daily limit reached
    END IF;

    -- Increment daily count
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
