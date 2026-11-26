-- Tests for supabase/migrations/20261130000000_deadline_pass.sql.
--
-- Same shape as user_usage_column_guard.test.sql: plain SQL DO blocks that
-- raise on failure and print `PASS: ...` otherwise, in one transaction that
-- rolls back. Run with the same psql invocation (see that file).

begin;

insert into auth.users (id, email, aud, role)
values
  ('00000000-0000-4000-8000-00000000d001', 'pass-test-1@example.com', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-00000000d002', 'pass-test-2@example.com', 'authenticated', 'authenticated');

do $$
begin
  if exists (select 1 from public.user_usage
             where user_id = '00000000-0000-4000-8000-00000000d001' and pro_until is not null) then
    raise exception 'FAIL: new rows must start without a pass';
  end if;
  raise notice 'PASS: signup rows start with pro_until = null';
end $$;

---------------------------------------------------------------------------
-- As user 1 (authenticated): pro_until and the grant are out of reach.
---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-00000000d001","role":"authenticated"}', true);

do $$
begin
  begin
    update public.user_usage set pro_until = now() + interval '1 year'
    where user_id = '00000000-0000-4000-8000-00000000d001';
    raise exception 'FAIL: a user could set their own pro_until';
  exception when insufficient_privilege then
    raise notice 'PASS: users cannot write pro_until';
  end;

  begin
    perform public.grant_pro_pass('00000000-0000-4000-8000-00000000d001', 'cs_self', 7);
    raise exception 'FAIL: a user could call grant_pro_pass';
  exception when insufficient_privilege then
    raise notice 'PASS: grant_pro_pass is service role only';
  end;

  begin
    perform 1 from public.pro_pass_purchases;
    raise exception 'FAIL: a user could read pro_pass_purchases';
  exception when insufficient_privilege then
    raise notice 'PASS: pro_pass_purchases is service role only';
  end;
end $$;

reset role;
select set_config('request.jwt.claims', '', true);

---------------------------------------------------------------------------
-- Service role: grant, idempotency, stacking, onboarding.
---------------------------------------------------------------------------

do $$
declare
  v_first timestamptz;
  v_again timestamptz;
  v_second timestamptz;
  v_row public.user_usage%rowtype;
begin
  v_first := public.grant_pro_pass('00000000-0000-4000-8000-00000000d001', 'cs_pass_a', 7, 499, 'usd');
  if v_first is null or abs(extract(epoch from (v_first - (now() + interval '7 days')))) > 5 then
    raise exception 'FAIL: first pass should end 7 days from now, got %', v_first;
  end if;

  select * into v_row from public.user_usage where user_id = '00000000-0000-4000-8000-00000000d001';
  if v_row.pro_until is distinct from v_first or not coalesce(v_row.onboarding_completed, false) then
    raise exception 'FAIL: grant must set pro_until and onboarding_completed';
  end if;
  if v_row.is_pro then
    raise exception 'FAIL: a pass must not touch is_pro (the subscription cache)';
  end if;
  raise notice 'PASS: a first pass ends 7 days from now and completes onboarding';

  v_again := public.grant_pro_pass('00000000-0000-4000-8000-00000000d001', 'cs_pass_a', 7, 499, 'usd');
  if v_again is not null then
    raise exception 'FAIL: a second grant of the same session returned %', v_again;
  end if;
  if (select pro_until from public.user_usage where user_id = '00000000-0000-4000-8000-00000000d001') <> v_first then
    raise exception 'FAIL: a redelivery moved pro_until';
  end if;
  if (select count(*) from public.pro_pass_purchases where checkout_session_id = 'cs_pass_a') <> 1 then
    raise exception 'FAIL: the ledger must have exactly one row per session';
  end if;
  raise notice 'PASS: grant_pro_pass is idempotent per session';

  v_second := public.grant_pro_pass('00000000-0000-4000-8000-00000000d001', 'cs_pass_b', 7, 499, 'usd');
  if v_second <> v_first + interval '7 days' then
    raise exception 'FAIL: a second pass should stack onto the first (%), got %', v_first, v_second;
  end if;
  raise notice 'PASS: a second pass stacks onto the running one';

  -- An expired pass restarts from now.
  update public.user_usage set pro_until = now() - interval '3 days'
  where user_id = '00000000-0000-4000-8000-00000000d002';
  v_first := public.grant_pro_pass('00000000-0000-4000-8000-00000000d002', 'cs_pass_c', 7);
  if abs(extract(epoch from (v_first - (now() + interval '7 days')))) > 5 then
    raise exception 'FAIL: a pass after an expired one should start from now, got %', v_first;
  end if;
  raise notice 'PASS: a pass after an expired one starts from now';

  begin
    perform public.grant_pro_pass('00000000-0000-4000-8000-00000000d002', 'cs_pass_bad', 0);
    raise exception 'FAIL: zero days accepted';
  exception when invalid_parameter_value then
    raise notice 'PASS: days must be positive';
  end;
end $$;

---------------------------------------------------------------------------
-- Quotas: a running pass uses the Pro allowance, an expired one the free one.
---------------------------------------------------------------------------

do $$
begin
  -- user 1 has a running pass and has used the free daily allowance.
  update public.user_usage
  set edit_count = 5, daily_reset_date = current_date,
      monthly_edit_count = 0, monthly_reset_date = current_date + 30,
      free_generations_used = 1, generation_credits = 0
  where user_id = '00000000-0000-4000-8000-00000000d001';

  if not public.increment_edit_count('00000000-0000-4000-8000-00000000d001') then
    raise exception 'FAIL: a pass holder past the free daily limit was refused an edit';
  end if;
  if (select monthly_edit_count from public.user_usage where user_id = '00000000-0000-4000-8000-00000000d001') <> 1 then
    raise exception 'FAIL: a pass holder''s edit must count on the monthly Pro counter';
  end if;
  raise notice 'PASS: increment_edit_count treats a running pass as Pro';

  if public.consume_generation('00000000-0000-4000-8000-00000000d001') <> 'pro' then
    raise exception 'FAIL: consume_generation must answer pro for a pass holder';
  end if;
  raise notice 'PASS: consume_generation treats a running pass as Pro';

  update public.user_usage set pro_until = now() - interval '1 minute'
  where user_id = '00000000-0000-4000-8000-00000000d001';
  if public.increment_edit_count('00000000-0000-4000-8000-00000000d001') then
    raise exception 'FAIL: an expired pass still granted the Pro allowance';
  end if;
  if public.consume_generation('00000000-0000-4000-8000-00000000d001') <> 'blocked' then
    raise exception 'FAIL: an expired pass still granted generations';
  end if;
  raise notice 'PASS: an expired pass falls back to the free allowance';
end $$;

rollback;
