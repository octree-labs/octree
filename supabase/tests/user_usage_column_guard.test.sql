-- Tests for supabase/migrations/20261018110000_user_usage_column_guard.sql.
--
-- Plain SQL (no pgTAP): every check is a DO block that raises on failure and
-- prints `PASS: ...` otherwise. The whole file runs in one transaction and
-- rolls back, so it leaves the database as it found it.
--
-- Run against a local stack:
--
--   supabase start && supabase db reset          # applies every migration
--   docker exec -i supabase_db_ai-latex-editor \
--     psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
--     < supabase/tests/user_usage_column_guard.test.sql
--
-- (or `psql "$DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/user_usage_column_guard.test.sql`
-- with DB_URL from `supabase status -o env`). psql must connect as postgres:
-- the file switches to the API roles with SET LOCAL ROLE and back again.
--
-- A request from the API is simulated the way PostgREST does it: SET LOCAL
-- ROLE to the API role and `request.jwt.claims` to the JWT payload, which is
-- what auth.uid() and auth.role() read.

begin;

-- Two throwaway users. handle_new_user (after-insert trigger on auth.users,
-- SECURITY DEFINER) creates each user_usage row, so the signup path is covered
-- by the setup itself.
insert into auth.users (id, email, aud, role)
values
  ('00000000-0000-4000-8000-000000000001', 'guard-test-1@example.com', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-000000000002', 'guard-test-2@example.com', 'authenticated', 'authenticated');

do $$
begin
  if (select count(*) from public.user_usage
      where user_id in ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002')
        and is_pro = false and edit_count = 0) <> 2 then
    raise exception 'FAIL: handle_new_user did not create the default rows';
  end if;
  raise notice 'PASS: signup trigger creates default rows through the guard';
end $$;

-- Seed state as postgres with no JWT (the migration / psql path).
update public.user_usage set edit_count = 3, monthly_edit_count = 10
where user_id = '00000000-0000-4000-8000-000000000001';

do $$
begin
  raise notice 'PASS: direct SQL with no JWT can write counters';
end $$;

---------------------------------------------------------------------------
-- As user 1 (authenticated)
---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-000000000001","role":"authenticated"}', true);

do $$
begin
  update public.user_usage set is_pro = true
  where user_id = '00000000-0000-4000-8000-000000000001';
  raise exception 'FAIL: user could set is_pro';
exception when insufficient_privilege then
  raise notice 'PASS: user PATCH of is_pro is rejected';
end $$;

do $$
begin
  update public.user_usage set subscription_status = 'active'
  where user_id = '00000000-0000-4000-8000-000000000001';
  raise exception 'FAIL: user could set subscription_status';
exception when insufficient_privilege then
  raise notice 'PASS: user PATCH of subscription_status is rejected';
end $$;

do $$
begin
  update public.user_usage set stripe_customer_id = 'cus_fake'
  where user_id = '00000000-0000-4000-8000-000000000001';
  raise exception 'FAIL: user could set stripe_customer_id';
exception when insufficient_privilege then
  raise notice 'PASS: user PATCH of stripe_customer_id is rejected';
end $$;

do $$
begin
  update public.user_usage set edit_count = 0, monthly_edit_count = 0
  where user_id = '00000000-0000-4000-8000-000000000001';
  raise exception 'FAIL: user could reset counters';
exception when insufficient_privilege then
  raise notice 'PASS: user decrease of edit_count / monthly_edit_count is rejected';
end $$;

do $$
begin
  update public.user_usage set edit_count = edit_count + 5
  where user_id = '00000000-0000-4000-8000-000000000001';
  raise exception 'FAIL: user could jump edit_count by 5';
exception when insufficient_privilege then
  raise notice 'PASS: user jump of edit_count by more than 1 is rejected';
end $$;

do $$
begin
  update public.user_usage set daily_reset_date = current_date - 1
  where user_id = '00000000-0000-4000-8000-000000000001';
  raise exception 'FAIL: user could move daily_reset_date';
exception when insufficient_privilege then
  raise notice 'PASS: user PATCH of daily_reset_date is rejected';
end $$;

do $$
begin
  update public.user_usage set monthly_reset_date = current_date + 400
  where user_id = '00000000-0000-4000-8000-000000000001';
  raise exception 'FAIL: user could move monthly_reset_date';
exception when insufficient_privilege then
  raise notice 'PASS: user PATCH of monthly_reset_date is rejected';
end $$;

-- Profile columns stay writable (lib/requests/user.ts, app/auth/oauth/route.ts).
do $$
declare r public.user_usage;
begin
  update public.user_usage
  set onboarding_completed = true, referral_source = 'tools', role = 'student', use_case = 'thesis'
  where user_id = '00000000-0000-4000-8000-000000000001';
  select * into r from public.user_usage where user_id = '00000000-0000-4000-8000-000000000001';
  if not r.onboarding_completed or r.referral_source <> 'tools' or r.role <> 'student' then
    raise exception 'FAIL: profile update did not stick';
  end if;
  raise notice 'PASS: user PATCH of onboarding_completed / referral_source / role / use_case is accepted';
end $$;

-- The PostgREST upsert used by upsertUserUsage: INSERT ... ON CONFLICT DO UPDATE
-- of the profile columns only.
do $$
begin
  insert into public.user_usage (user_id, onboarding_completed)
  values ('00000000-0000-4000-8000-000000000001', false)
  on conflict (user_id) do update set onboarding_completed = excluded.onboarding_completed;
  if (select onboarding_completed from public.user_usage
      where user_id = '00000000-0000-4000-8000-000000000001') then
    raise exception 'FAIL: upsert of onboarding_completed did not stick';
  end if;
  raise notice 'PASS: user upsert (on conflict do update) of profile columns is accepted';
end $$;

-- The counter path: increment_edit_count is SECURITY DEFINER, so its own
-- resets and increments pass the guard, but it only moves the caller's row.
do $$
declare ok boolean; n integer;
begin
  ok := public.increment_edit_count('00000000-0000-4000-8000-000000000001');
  select edit_count into n from public.user_usage
  where user_id = '00000000-0000-4000-8000-000000000001';
  if not ok or n <> 4 then
    raise exception 'FAIL: increment_edit_count returned % and left edit_count at %', ok, n;
  end if;
  raise notice 'PASS: user RPC increment_edit_count(self) increments through the guard';
end $$;

do $$
begin
  perform public.increment_edit_count('00000000-0000-4000-8000-000000000002');
  raise exception 'FAIL: user could increment another user''s usage';
exception when insufficient_privilege then
  raise notice 'PASS: user RPC increment_edit_count(other user) is rejected';
end $$;

do $$
begin
  perform public.update_user_subscription_status(
    '00000000-0000-4000-8000-000000000001', 'cus_x', 'sub_x', 'active', now(), now(), false);
  raise exception 'FAIL: user could call update_user_subscription_status';
exception when insufficient_privilege then
  raise notice 'PASS: user RPC update_user_subscription_status is rejected (execute revoked)';
end $$;

reset role;
select set_config('request.jwt.claims', '', true);

-- The daily reset inside increment_edit_count (a decrease to 0 plus a
-- daily_reset_date change) must still work when a user calls it.
update public.user_usage set daily_reset_date = current_date - 1, edit_count = 5
where user_id = '00000000-0000-4000-8000-000000000001';

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-000000000001","role":"authenticated"}', true);

do $$
declare ok boolean; n integer; d date;
begin
  ok := public.increment_edit_count('00000000-0000-4000-8000-000000000001');
  select edit_count, daily_reset_date into n, d from public.user_usage
  where user_id = '00000000-0000-4000-8000-000000000001';
  if not ok or n <> 1 or d <> current_date then
    raise exception 'FAIL: daily reset inside increment_edit_count was blocked (ok=%, edit_count=%, reset=%)', ok, n, d;
  end if;
  raise notice 'PASS: daily reset inside increment_edit_count (SECURITY DEFINER) passes the guard';
end $$;

reset role;
select set_config('request.jwt.claims', '', true);

---------------------------------------------------------------------------
-- Insert guard, as user 2 whose row has been removed.
---------------------------------------------------------------------------
delete from public.user_usage where user_id = '00000000-0000-4000-8000-000000000002';

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-000000000002","role":"authenticated"}', true);

do $$
begin
  insert into public.user_usage (user_id, is_pro, subscription_status)
  values ('00000000-0000-4000-8000-000000000002', true, 'active');
  raise exception 'FAIL: user could insert a pro row';
exception when insufficient_privilege then
  raise notice 'PASS: user INSERT with is_pro=true is rejected';
end $$;

do $$
begin
  insert into public.user_usage (user_id, edit_count, monthly_edit_count, monthly_reset_date, is_pro, subscription_status)
  values ('00000000-0000-4000-8000-000000000002', 0, 0, current_date + 30, false, 'inactive');
  if not exists (select 1 from public.user_usage
                 where user_id = '00000000-0000-4000-8000-000000000002' and is_pro = false) then
    raise exception 'FAIL: default insert did not land';
  end if;
  raise notice 'PASS: user INSERT with free-tier defaults (app/api/octra-agent shape) is accepted';
end $$;

reset role;
select set_config('request.jwt.claims', '', true);

---------------------------------------------------------------------------
-- As the service role
---------------------------------------------------------------------------
set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);

do $$
declare r public.user_usage;
begin
  update public.user_usage
  set is_pro = true, subscription_status = 'active', stripe_customer_id = 'cus_123',
      edit_count = 0, monthly_edit_count = 0, monthly_reset_date = current_date + 30
  where user_id = '00000000-0000-4000-8000-000000000001';
  select * into r from public.user_usage where user_id = '00000000-0000-4000-8000-000000000001';
  if not r.is_pro or r.subscription_status <> 'active' or r.edit_count <> 0 then
    raise exception 'FAIL: service role update did not stick';
  end if;
  raise notice 'PASS: service role PATCH of is_pro / status / counters is accepted';
end $$;

do $$
begin
  perform public.update_user_subscription_status(
    '00000000-0000-4000-8000-000000000002', 'cus_2', 'sub_2', 'trialing', now(), now() + interval '30 days', false);
  if not (select is_pro from public.user_usage where user_id = '00000000-0000-4000-8000-000000000002') then
    raise exception 'FAIL: update_user_subscription_status as service role did not set is_pro';
  end if;
  raise notice 'PASS: service role RPC update_user_subscription_status is accepted';
end $$;

reset role;
select set_config('request.jwt.claims', '', true);

---------------------------------------------------------------------------
-- Counter edge cases and upserts, as user 1 again (row reseeded to 5 edits).
---------------------------------------------------------------------------
update public.user_usage set is_pro = false, subscription_status = 'inactive', edit_count = 5
where user_id = '00000000-0000-4000-8000-000000000001';

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-000000000001","role":"authenticated"}', true);

do $$
begin
  update public.user_usage set edit_count = 7
  where user_id = '00000000-0000-4000-8000-000000000001';
  raise exception 'FAIL: user could move edit_count from 5 to 7 in one statement';
exception when insufficient_privilege then
  raise notice 'PASS: user edit_count 5 -> 7 in one statement is rejected';
end $$;

do $$
begin
  update public.user_usage set user_id = '00000000-0000-4000-8000-000000000002'
  where user_id = '00000000-0000-4000-8000-000000000001';
  raise exception 'FAIL: user could re-point their row at another user_id';
exception when insufficient_privilege then
  raise notice 'PASS: user change of user_id is rejected';
end $$;

-- A +1 per statement is allowed by design: it only ever charges the caller
-- more. Repeating it in one transaction climbs past the daily limit, which
-- is harmless (the limit is enforced by increment_edit_count and the API,
-- which read the counter; a user can only make it larger).
do $$
declare n integer;
begin
  for i in 1..10 loop
    update public.user_usage set edit_count = edit_count + 1
    where user_id = '00000000-0000-4000-8000-000000000001';
  end loop;
  select edit_count into n from public.user_usage
  where user_id = '00000000-0000-4000-8000-000000000001';
  if n <> 15 then
    raise exception 'FAIL: ten +1 statements left edit_count at %', n;
  end if;
  raise notice 'PASS: user +1 per statement is accepted (5 -> 15 over ten statements; counters only climb)';
end $$;

-- PostgREST upsert of the caller's own row.
do $$
declare r public.user_usage;
begin
  insert into public.user_usage (user_id, is_pro, onboarding_completed)
  values ('00000000-0000-4000-8000-000000000001', false, true)
  on conflict (user_id) do update set onboarding_completed = excluded.onboarding_completed;
  select * into r from public.user_usage where user_id = '00000000-0000-4000-8000-000000000001';
  if not r.onboarding_completed or r.is_pro then
    raise exception 'FAIL: upsert with is_pro=false did not land as expected';
  end if;
  raise notice 'PASS: user upsert of own row with is_pro=false is accepted';
end $$;

do $$
begin
  insert into public.user_usage (user_id, is_pro, onboarding_completed)
  values ('00000000-0000-4000-8000-000000000001', true, true)
  on conflict (user_id) do update set is_pro = excluded.is_pro;
  raise exception 'FAIL: user could upsert is_pro=true';
exception when insufficient_privilege then
  raise notice 'PASS: user upsert of own row with is_pro=true is rejected';
end $$;

do $$
begin
  insert into public.user_usage (user_id)
  values ('00000000-0000-4000-8000-000000000001')
  on conflict (user_id) do update set edit_count = 0, daily_reset_date = current_date + 1;
  raise exception 'FAIL: user could reset counters through ON CONFLICT DO UPDATE';
exception when insufficient_privilege then
  raise notice 'PASS: user ON CONFLICT DO UPDATE of counters is rejected';
end $$;

reset role;
select set_config('request.jwt.claims', '', true);

---------------------------------------------------------------------------
-- As anon: RLS already hides every row; nothing is writable.
---------------------------------------------------------------------------
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);

do $$
declare n integer;
begin
  update public.user_usage set is_pro = true;
  get diagnostics n = row_count;
  if n <> 0 then
    raise exception 'FAIL: anon updated % rows', n;
  end if;
  raise notice 'PASS: anon UPDATE touches no rows';
end $$;

do $$
begin
  insert into public.user_usage (user_id) values ('00000000-0000-4000-8000-000000000001');
  raise exception 'FAIL: anon could insert';
exception when insufficient_privilege or unique_violation then
  raise notice 'PASS: anon INSERT is rejected';
end $$;

reset role;
select set_config('request.jwt.claims', '', true);

---------------------------------------------------------------------------
-- As the service role: everything the users were refused must succeed.
---------------------------------------------------------------------------
insert into auth.users (id, email, aud, role)
values ('00000000-0000-4000-8000-000000000003', 'guard-test-3@example.com', 'authenticated', 'authenticated');
delete from public.user_usage where user_id = '00000000-0000-4000-8000-000000000003';

set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);

do $$
declare r public.user_usage;
begin
  insert into public.user_usage (user_id, is_pro, subscription_status, stripe_customer_id, edit_count)
  values ('00000000-0000-4000-8000-000000000003', true, 'active', 'cus_3', 4);
  select * into r from public.user_usage where user_id = '00000000-0000-4000-8000-000000000003';
  if not r.is_pro or r.edit_count <> 4 then
    raise exception 'FAIL: service role INSERT of a pro row did not land';
  end if;
  raise notice 'PASS: service role INSERT with is_pro=true / counters is accepted';
end $$;

do $$
declare r public.user_usage;
begin
  update public.user_usage
  set edit_count = 0, monthly_edit_count = 0,
      daily_reset_date = current_date - 1, monthly_reset_date = current_date + 400,
      user_id = user_id,
      onboarding_completed = false, referral_source = 'svc', role = 'svc', use_case = 'svc'
  where user_id = '00000000-0000-4000-8000-000000000001';
  select * into r from public.user_usage where user_id = '00000000-0000-4000-8000-000000000001';
  if r.edit_count <> 0 or r.daily_reset_date <> current_date - 1 or r.referral_source <> 'svc' then
    raise exception 'FAIL: service role reset/profile update did not stick';
  end if;
  raise notice 'PASS: service role reset of counters, reset dates and profile columns is accepted';
end $$;

do $$
declare r public.user_usage;
begin
  insert into public.user_usage (user_id, is_pro, onboarding_completed)
  values ('00000000-0000-4000-8000-000000000001', true, true)
  on conflict (user_id) do update set is_pro = excluded.is_pro, onboarding_completed = excluded.onboarding_completed;
  select * into r from public.user_usage where user_id = '00000000-0000-4000-8000-000000000001';
  if not r.is_pro then
    raise exception 'FAIL: service role upsert of is_pro=true did not stick';
  end if;
  raise notice 'PASS: service role upsert with is_pro=true is accepted';
end $$;

do $$
declare ok boolean; n integer;
begin
  ok := public.increment_edit_count('00000000-0000-4000-8000-000000000003');
  select edit_count, monthly_edit_count into n, n from public.user_usage
  where user_id = '00000000-0000-4000-8000-000000000003';
  if not ok then
    raise exception 'FAIL: service role increment_edit_count(other user) returned false';
  end if;
  raise notice 'PASS: service role RPC increment_edit_count(any user) is accepted';
end $$;

reset role;
select set_config('request.jwt.claims', '', true);

do $$
begin
  raise notice 'ALL PASSED';
end $$;

rollback;
