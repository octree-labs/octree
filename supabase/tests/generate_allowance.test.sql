-- Tests for supabase/migrations/20261018150000_generate_allowance.sql.
--
-- Same shape as user_usage_column_guard.test.sql: plain SQL DO blocks that
-- raise on failure and print `PASS: ...` otherwise, in one transaction that
-- rolls back. Run with the same psql invocation (see that file), after
-- user_usage_column_guard.test.sql, which must still pass unchanged: the
-- guard trigger is recreated here and has to stay a superset of #395 (and of
-- #401's edit_credits).
--
-- The abuse paths this covers: a user cannot PATCH/INSERT/upsert the two
-- allowance columns, cannot refund or grant themselves anything (execute
-- revoked), cannot consume for another user, cannot delete their row to
-- start over (no DELETE policy), and consume_generation gives exactly one
-- free generation per account before credits / blocked.

begin;

insert into auth.users (id, email, aud, role)
values
  ('00000000-0000-4000-8000-00000000a001', 'gen-test-1@example.com', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-00000000a002', 'gen-test-2@example.com', 'authenticated', 'authenticated');

do $$
begin
  if (select count(*) from public.user_usage
      where user_id in ('00000000-0000-4000-8000-00000000a001', '00000000-0000-4000-8000-00000000a002')
        and free_generations_used = 0 and generation_credits = 0) <> 2 then
    raise exception 'FAIL: new rows do not start with the free generation available and 0 credits';
  end if;
  raise notice 'PASS: signup rows start with free_generations_used = 0 and generation_credits = 0';
end $$;

---------------------------------------------------------------------------
-- As user 1 (authenticated): the columns are read-only, the RPCs self-only.
---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-00000000a001","role":"authenticated"}', true);

do $$
begin
  update public.user_usage set generation_credits = 1000
  where user_id = '00000000-0000-4000-8000-00000000a001';
  raise exception 'FAIL: user could set generation_credits';
exception when insufficient_privilege then
  raise notice 'PASS: user PATCH of generation_credits is rejected';
end $$;

do $$
begin
  update public.user_usage set free_generations_used = 5
  where user_id = '00000000-0000-4000-8000-00000000a001';
  raise exception 'FAIL: user could set free_generations_used';
exception when insufficient_privilege then
  raise notice 'PASS: user PATCH of free_generations_used is rejected';
end $$;

do $$
begin
  update public.user_usage set edit_credits = 1000
  where user_id = '00000000-0000-4000-8000-00000000a001';
  raise exception 'FAIL: user could set edit_credits (guard lost #401''s column)';
exception when insufficient_privilege then
  raise notice 'PASS: user PATCH of edit_credits is still rejected (superset of #401)';
end $$;

do $$
begin
  update public.user_usage set is_pro = true
  where user_id = '00000000-0000-4000-8000-00000000a001';
  raise exception 'FAIL: user could set is_pro (guard lost #395''s rules)';
exception when insufficient_privilege then
  raise notice 'PASS: user PATCH of is_pro is still rejected (superset of #395)';
end $$;

do $$
begin
  insert into public.user_usage (user_id, generation_credits)
  values ('00000000-0000-4000-8000-00000000a001', 5)
  on conflict (user_id) do update set generation_credits = excluded.generation_credits;
  raise exception 'FAIL: user could upsert generation_credits';
exception when insufficient_privilege then
  raise notice 'PASS: user upsert of generation_credits is rejected';
end $$;

do $$
begin
  perform public.refund_generation('00000000-0000-4000-8000-00000000a001', 'credit');
  raise exception 'FAIL: user could call refund_generation (would mint credits)';
exception when insufficient_privilege then
  raise notice 'PASS: user RPC refund_generation is rejected (execute revoked)';
end $$;

do $$
begin
  perform public.grant_generation_credits('00000000-0000-4000-8000-00000000a001', 100);
  raise exception 'FAIL: user could call grant_generation_credits';
exception when insufficient_privilege then
  raise notice 'PASS: user RPC grant_generation_credits is rejected (execute revoked)';
end $$;

do $$
begin
  perform public.grant_generation_purchase('00000000-0000-4000-8000-00000000a001', 'cs_forged', 100, 0, 'usd');
  raise exception 'FAIL: user could call grant_generation_purchase';
exception when insufficient_privilege then
  raise notice 'PASS: user RPC grant_generation_purchase is rejected (execute revoked)';
end $$;

do $$
begin
  perform * from public.generation_purchases;
  raise exception 'FAIL: user could read generation_purchases';
exception when insufficient_privilege then
  raise notice 'PASS: user SELECT on generation_purchases is rejected';
end $$;

do $$
begin
  perform public.consume_generation('00000000-0000-4000-8000-00000000a002');
  raise exception 'FAIL: user could consume another user''s allowance';
exception when insufficient_privilege then
  raise notice 'PASS: user RPC consume_generation(other user) is rejected';
end $$;

-- The one free generation, then blocked.
do $$
declare k text; n integer;
begin
  k := public.consume_generation('00000000-0000-4000-8000-00000000a001');
  select free_generations_used into n from public.user_usage where user_id = '00000000-0000-4000-8000-00000000a001';
  if k <> 'free' or n <> 1 then
    raise exception 'FAIL: first consume returned % and left free_generations_used at %', k, n;
  end if;
  k := public.consume_generation('00000000-0000-4000-8000-00000000a001');
  if k <> 'blocked' then
    raise exception 'FAIL: second consume returned % (a second free generation)', k;
  end if;
  raise notice 'PASS: user RPC consume_generation(self): free once, then blocked';
end $$;

-- Starting over by deleting the row: RLS has no DELETE policy.
do $$
declare n integer; k text;
begin
  delete from public.user_usage where user_id = '00000000-0000-4000-8000-00000000a001';
  get diagnostics n = row_count;
  if n <> 0 then
    raise exception 'FAIL: user deleted % of their own user_usage rows', n;
  end if;
  k := public.consume_generation('00000000-0000-4000-8000-00000000a001');
  if k <> 'blocked' then
    raise exception 'FAIL: consume after a delete attempt returned %', k;
  end if;
  raise notice 'PASS: user DELETE of their user_usage row touches nothing; still blocked';
end $$;

reset role;
select set_config('request.jwt.claims', '', true);

---------------------------------------------------------------------------
-- As the service role (the Stripe webhook and the refund path).
---------------------------------------------------------------------------
set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);

do $$
declare bal integer;
begin
  bal := public.grant_generation_purchase('00000000-0000-4000-8000-00000000a001', 'cs_gen_1', 1, 299, 'usd');
  if bal <> 1 then
    raise exception 'FAIL: first grant returned balance %', bal;
  end if;
  if (select count(*) from public.generation_purchases where checkout_session_id = 'cs_gen_1') <> 1 then
    raise exception 'FAIL: ledger row missing';
  end if;
  raise notice 'PASS: service role grant_generation_purchase writes the ledger row and the balance (1)';
end $$;

do $$
declare bal integer;
begin
  bal := public.grant_generation_purchase('00000000-0000-4000-8000-00000000a001', 'cs_gen_1', 1, 299, 'usd');
  if bal is not null then
    raise exception 'FAIL: redelivered session granted again (balance %)', bal;
  end if;
  if (select generation_credits from public.user_usage where user_id = '00000000-0000-4000-8000-00000000a001') <> 1 then
    raise exception 'FAIL: balance changed on redelivery';
  end if;
  raise notice 'PASS: a redelivered checkout session grants nothing (NULL) and leaves the balance at 1';
end $$;

do $$
begin
  perform public.grant_generation_purchase('00000000-0000-4000-8000-00000000a001', 'cs_gen_bad', 0, 0, 'usd');
  raise exception 'FAIL: zero-credit purchase accepted';
exception when invalid_parameter_value then
  raise notice 'PASS: zero-credit grant_generation_purchase is rejected';
end $$;

do $$
begin
  perform public.grant_generation_purchase('00000000-0000-4000-8000-00000000a001', '', 1, 0, 'usd');
  raise exception 'FAIL: empty session id accepted';
exception when invalid_parameter_value then
  raise notice 'PASS: grant_generation_purchase without a session id is rejected';
end $$;

do $$
declare bal integer;
begin
  bal := public.grant_generation_credits('00000000-0000-4000-8000-00000000a001', 2);
  if bal <> 3 then
    raise exception 'FAIL: support grant returned balance %', bal;
  end if;
  raise notice 'PASS: service role grant_generation_credits adds to the balance (3)';
end $$;

do $$
begin
  perform public.grant_generation_credits('00000000-0000-4000-8000-00000000a001', -5);
  raise exception 'FAIL: negative grant accepted';
exception when invalid_parameter_value then
  raise notice 'PASS: grant_generation_credits rejects credits <= 0';
end $$;

-- A buyer who never loaded /api/subscription-status has no row yet.
delete from public.user_usage where user_id = '00000000-0000-4000-8000-00000000a002';
do $$
declare bal integer;
begin
  bal := public.grant_generation_purchase('00000000-0000-4000-8000-00000000a002', 'cs_gen_2', 1, 299, 'usd');
  if bal <> 1 then
    raise exception 'FAIL: grant without a user_usage row returned %', bal;
  end if;
  raise notice 'PASS: grant creates the user_usage row when missing';
end $$;

do $$
begin
  update public.user_usage set generation_credits = -1
  where user_id = '00000000-0000-4000-8000-00000000a002';
  raise exception 'FAIL: negative balance accepted';
exception when check_violation then
  raise notice 'PASS: generation_credits cannot go negative (check constraint)';
end $$;

reset role;
select set_config('request.jwt.claims', '', true);

---------------------------------------------------------------------------
-- As user 1 again: credits are spent one at a time, then blocked.
---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-00000000a001","role":"authenticated"}', true);

do $$
declare k text; n integer;
begin
  k := public.consume_generation('00000000-0000-4000-8000-00000000a001');
  select generation_credits into n from public.user_usage where user_id = '00000000-0000-4000-8000-00000000a001';
  if k <> 'credit' or n <> 2 then
    raise exception 'FAIL: consume returned % and left the balance at %', k, n;
  end if;
  if public.consume_generation('00000000-0000-4000-8000-00000000a001') <> 'credit'
    or public.consume_generation('00000000-0000-4000-8000-00000000a001') <> 'credit' then
    raise exception 'FAIL: could not drain the balance';
  end if;
  k := public.consume_generation('00000000-0000-4000-8000-00000000a001');
  select generation_credits into n from public.user_usage where user_id = '00000000-0000-4000-8000-00000000a001';
  if k <> 'blocked' or n <> 0 then
    raise exception 'FAIL: after draining, consume returned % with balance %', k, n;
  end if;
  raise notice 'PASS: credits are spent one per consume (3 -> 0) and the next consume is blocked';
end $$;

reset role;
select set_config('request.jwt.claims', '', true);

---------------------------------------------------------------------------
-- Refund (service role): hands back exactly what was consumed.
---------------------------------------------------------------------------
set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);

do $$
declare ok boolean; n integer; f integer;
begin
  ok := public.refund_generation('00000000-0000-4000-8000-00000000a001', 'credit');
  select generation_credits, free_generations_used into n, f from public.user_usage
  where user_id = '00000000-0000-4000-8000-00000000a001';
  if not ok or n <> 1 or f <> 1 then
    raise exception 'FAIL: credit refund returned % (credits %, free used %)', ok, n, f;
  end if;
  ok := public.refund_generation('00000000-0000-4000-8000-00000000a001', 'free');
  select generation_credits, free_generations_used into n, f from public.user_usage
  where user_id = '00000000-0000-4000-8000-00000000a001';
  if not ok or n <> 1 or f <> 0 then
    raise exception 'FAIL: free refund returned % (credits %, free used %)', ok, n, f;
  end if;
  if public.refund_generation('00000000-0000-4000-8000-00000000a001', 'free') then
    raise exception 'FAIL: a second free refund changed something';
  end if;
  if public.refund_generation('00000000-0000-4000-8000-00000000a001', 'pro') then
    raise exception 'FAIL: a pro refund changed something';
  end if;
  raise notice 'PASS: service role refund_generation returns the credit / the free one; free is capped at one, pro is a no-op';
end $$;

reset role;
select set_config('request.jwt.claims', '', true);

---------------------------------------------------------------------------
-- Pro never consumes; a missing row is created with the free one available.
---------------------------------------------------------------------------
update public.user_usage set is_pro = true where user_id = '00000000-0000-4000-8000-00000000a001';

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-00000000a001","role":"authenticated"}', true);

do $$
declare k text; n integer; f integer;
begin
  k := public.consume_generation('00000000-0000-4000-8000-00000000a001');
  select generation_credits, free_generations_used into n, f from public.user_usage
  where user_id = '00000000-0000-4000-8000-00000000a001';
  if k <> 'pro' or n <> 1 or f <> 0 then
    raise exception 'FAIL: pro consume returned % and moved the balances (credits %, free used %)', k, n, f;
  end if;
  raise notice 'PASS: consume_generation for a Pro row returns pro and changes nothing';
end $$;

reset role;
select set_config('request.jwt.claims', '', true);

delete from public.user_usage where user_id = '00000000-0000-4000-8000-00000000a001';

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-00000000a001","role":"authenticated"}', true);

do $$
declare k text; f integer;
begin
  k := public.consume_generation('00000000-0000-4000-8000-00000000a001');
  select free_generations_used into f from public.user_usage
  where user_id = '00000000-0000-4000-8000-00000000a001';
  if k <> 'free' or f <> 1 then
    raise exception 'FAIL: consume without a row returned % (free used %)', k, f;
  end if;
  if public.consume_generation('00000000-0000-4000-8000-00000000a001') <> 'blocked' then
    raise exception 'FAIL: a second free generation after row creation';
  end if;
  raise notice 'PASS: consume_generation creates a missing row with the free one, spends it, then blocks';
end $$;

reset role;
select set_config('request.jwt.claims', '', true);

do $$ begin raise notice 'ALL PASSED'; end $$;

rollback;
