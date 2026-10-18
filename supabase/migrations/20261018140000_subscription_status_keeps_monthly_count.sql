-- update_user_subscription_status must not zero the Pro monthly edit counter
-- on every call.
--
-- The baseline version set monthly_edit_count = 0 (and pushed
-- monthly_reset_date a month out) whenever p_subscription_status was active
-- or trialing. GET /api/subscription-status calls it on every page load for
-- every subscriber, so Pro counters never got past 0, the 500/month cap was
-- never enforced and the lazy reset date kept sliding. The counter now
-- resets only when the write opens a billing period the row has not seen:
--   * the row was not Pro (first activation, resume after a pause),
--   * a different subscription id,
--   * current_period_start moved forward (a renewal).
-- The reset date becomes the billing date Stripe sent (period end) so the
-- lazy reset in increment_edit_count lines up with it; a write that carries
-- the same period keeps the counter and the reset date. A call that changes
-- nothing writes nothing, so a status read no longer touches updated_at.
--
-- Same rule in TypeScript for the webhook and the route:
-- lib/subscription/billing-period.ts. Idempotent; run after deploy (the
-- route is correct with either version, the old one just keeps zeroing).

create or replace function public.update_user_subscription_status(
  p_user_id uuid,
  p_stripe_customer_id text,
  p_stripe_subscription_id text,
  p_subscription_status text,
  p_current_period_start timestamptz,
  p_current_period_end timestamptz,
  p_cancel_at_period_end boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_is_pro boolean := p_subscription_status in ('active', 'trialing');
  v_old public.user_usage%rowtype;
  v_new_period boolean;
  v_reset_date date;
begin
  select * into v_old from public.user_usage where user_id = p_user_id;
  if not found then
    return;
  end if;

  v_new_period := v_is_pro and (
    not coalesce(v_old.is_pro, false)
    or v_old.stripe_subscription_id is distinct from p_stripe_subscription_id
    or v_old.current_period_start is null
    or (p_current_period_start is not null and p_current_period_start > v_old.current_period_start)
  );

  v_reset_date := case
    when p_current_period_end is not null and p_current_period_end > now()
      then (p_current_period_end at time zone 'utc')::date
    else (current_date + interval '1 month')::date
  end;

  update public.user_usage
  set
    stripe_customer_id = p_stripe_customer_id,
    stripe_subscription_id = p_stripe_subscription_id,
    subscription_status = p_subscription_status,
    current_period_start = p_current_period_start,
    current_period_end = p_current_period_end,
    cancel_at_period_end = p_cancel_at_period_end,
    is_pro = v_is_pro,
    monthly_edit_count = case when v_new_period then 0 else monthly_edit_count end,
    monthly_reset_date = case when v_new_period then v_reset_date else monthly_reset_date end,
    updated_at = now()
  where user_id = p_user_id
    and (
      v_new_period
      or stripe_customer_id is distinct from p_stripe_customer_id
      or stripe_subscription_id is distinct from p_stripe_subscription_id
      or subscription_status is distinct from p_subscription_status
      or current_period_start is distinct from p_current_period_start
      or current_period_end is distinct from p_current_period_end
      or cancel_at_period_end is distinct from p_cancel_at_period_end
      or is_pro is distinct from v_is_pro
    );
end;
$$;

-- Keep the grants from 20261018110000: service role only.
revoke execute on function public.update_user_subscription_status(uuid, text, text, text, timestamptz, timestamptz, boolean)
  from public, anon, authenticated;
grant execute on function public.update_user_subscription_status(uuid, text, text, text, timestamptz, timestamptz, boolean)
  to service_role;
