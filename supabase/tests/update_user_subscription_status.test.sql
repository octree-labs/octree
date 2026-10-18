-- Tests for supabase/migrations/20261018140000_subscription_status_keeps_monthly_count.sql.
--
-- Same shape as user_usage_column_guard.test.sql: plain SQL, every check is a
-- DO block that raises on failure and prints `PASS: ...` otherwise, one
-- transaction that rolls back. Run against a local stack:
--
--   supabase start && supabase db reset
--   docker exec -i supabase_db_ai-latex-editor \
--     psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
--     < supabase/tests/update_user_subscription_status.test.sql

begin;

insert into auth.users (id, email, aud, role)
values ('00000000-0000-4000-8000-000000000011', 'status-test-1@example.com', 'authenticated', 'authenticated');

-- First activation: Pro on, counter 0, reset date = billing date.
select public.update_user_subscription_status(
  '00000000-0000-4000-8000-000000000011', 'cus_1', 'sub_1', 'active',
  '2026-10-01T00:00:00Z', '2026-11-01T00:00:00Z', false);

do $$
declare r public.user_usage%rowtype;
begin
  select * into r from public.user_usage where user_id = '00000000-0000-4000-8000-000000000011';
  if not r.is_pro or r.monthly_edit_count <> 0 or r.monthly_reset_date <> date '2026-11-01' then
    raise exception 'FAIL: activation should set is_pro, counter 0, reset date = period end (got %, %, %)',
      r.is_pro, r.monthly_edit_count, r.monthly_reset_date;
  end if;
  raise notice 'PASS: first activation sets Pro and the billing-date reset';
end $$;

-- Seven edits this period, then the status route repeats the same period.
update public.user_usage
set monthly_edit_count = 7, updated_at = '2020-01-01'
where user_id = '00000000-0000-4000-8000-000000000011';

select public.update_user_subscription_status(
  '00000000-0000-4000-8000-000000000011', 'cus_1', 'sub_1', 'active',
  '2026-10-01T00:00:00Z', '2026-11-01T00:00:00Z', false);

do $$
declare r public.user_usage%rowtype;
begin
  select * into r from public.user_usage where user_id = '00000000-0000-4000-8000-000000000011';
  if r.monthly_edit_count <> 7 then
    raise exception 'FAIL: a status read within the period reset the counter to %', r.monthly_edit_count;
  end if;
  if r.updated_at <> '2020-01-01' then
    raise exception 'FAIL: a status read that changes nothing should not write';
  end if;
  raise notice 'PASS: same-period call keeps the counter and writes nothing';
end $$;

-- cancel_at_period_end toggled within the period: written, counter kept.
select public.update_user_subscription_status(
  '00000000-0000-4000-8000-000000000011', 'cus_1', 'sub_1', 'active',
  '2026-10-01T00:00:00Z', '2026-11-01T00:00:00Z', true);

do $$
declare r public.user_usage%rowtype;
begin
  select * into r from public.user_usage where user_id = '00000000-0000-4000-8000-000000000011';
  if not r.cancel_at_period_end or r.monthly_edit_count <> 7 then
    raise exception 'FAIL: cancel toggle should be written without resetting (got %, %)',
      r.cancel_at_period_end, r.monthly_edit_count;
  end if;
  raise notice 'PASS: cancel_at_period_end toggle keeps the counter';
end $$;

-- Renewal: current_period_start moved forward.
select public.update_user_subscription_status(
  '00000000-0000-4000-8000-000000000011', 'cus_1', 'sub_1', 'active',
  '2026-11-01T00:00:00Z', '2026-12-01T00:00:00Z', false);

do $$
declare r public.user_usage%rowtype;
begin
  select * into r from public.user_usage where user_id = '00000000-0000-4000-8000-000000000011';
  if r.monthly_edit_count <> 0 or r.monthly_reset_date <> date '2026-12-01' then
    raise exception 'FAIL: renewal should reset the counter and move the reset date (got %, %)',
      r.monthly_edit_count, r.monthly_reset_date;
  end if;
  raise notice 'PASS: renewal resets the counter to the new billing date';
end $$;

-- Paused: Pro off, counter kept; resume: counter reset.
update public.user_usage set monthly_edit_count = 3
where user_id = '00000000-0000-4000-8000-000000000011';

select public.update_user_subscription_status(
  '00000000-0000-4000-8000-000000000011', 'cus_1', 'sub_1', 'paused',
  '2026-11-01T00:00:00Z', '2026-12-01T00:00:00Z', false);

do $$
declare r public.user_usage%rowtype;
begin
  select * into r from public.user_usage where user_id = '00000000-0000-4000-8000-000000000011';
  if r.is_pro or r.monthly_edit_count <> 3 then
    raise exception 'FAIL: pause should drop Pro and keep the counter (got %, %)', r.is_pro, r.monthly_edit_count;
  end if;
  raise notice 'PASS: pause keeps the counter';
end $$;

-- The API role still cannot call it (grant from 20261018110000 kept).
do $$
begin
  set local role authenticated;
  perform set_config('request.jwt.claims',
    '{"sub":"00000000-0000-4000-8000-000000000011","role":"authenticated"}', true);
  begin
    perform public.update_user_subscription_status(
      '00000000-0000-4000-8000-000000000011', 'x', 'x', 'active', now(), now(), false);
    raise exception 'FAIL: authenticated could execute update_user_subscription_status';
  exception
    when insufficient_privilege then
      raise notice 'PASS: authenticated cannot execute update_user_subscription_status';
  end;
  reset role;
end $$;

rollback;
