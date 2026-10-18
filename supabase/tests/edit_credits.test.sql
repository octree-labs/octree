-- Tests for supabase/migrations/20261018141000_edit_credits.sql.
--
-- Same shape as user_usage_column_guard.test.sql: plain SQL DO blocks that
-- raise on failure and print `PASS: ...` otherwise, in one transaction that
-- rolls back. Run with the same psql invocation (see that file), after
-- user_usage_column_guard.test.sql, which must still pass unchanged: the
-- guard trigger is recreated here and has to stay a superset of #395.

begin;

insert into auth.users (id, email, aud, role)
values
  ('00000000-0000-4000-8000-00000000c001', 'credits-test-1@example.com', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-00000000c002', 'credits-test-2@example.com', 'authenticated', 'authenticated');

do $$
begin
  if (select count(*) from public.user_usage
      where user_id in ('00000000-0000-4000-8000-00000000c001', '00000000-0000-4000-8000-00000000c002')
        and edit_credits = 0) <> 2 then
    raise exception 'FAIL: new rows do not start with 0 credits';
  end if;
  raise notice 'PASS: signup rows start with edit_credits = 0';
end $$;

---------------------------------------------------------------------------
-- As user 1 (authenticated): the balance is read-only, credits spendable.
---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-00000000c001","role":"authenticated"}', true);

do $$
begin
  update public.user_usage set edit_credits = 1000
  where user_id = '00000000-0000-4000-8000-00000000c001';
  raise exception 'FAIL: user could set edit_credits';
exception when insufficient_privilege then
  raise notice 'PASS: user PATCH of edit_credits is rejected';
end $$;

do $$
begin
  insert into public.user_usage (user_id, edit_credits)
  values ('00000000-0000-4000-8000-00000000c001', 5)
  on conflict (user_id) do update set edit_credits = excluded.edit_credits;
  raise exception 'FAIL: user could upsert edit_credits';
exception when insufficient_privilege then
  raise notice 'PASS: user upsert of edit_credits is rejected';
end $$;

do $$
begin
  perform public.add_edit_credits('00000000-0000-4000-8000-00000000c001', 100);
  raise exception 'FAIL: user could call add_edit_credits';
exception when insufficient_privilege then
  raise notice 'PASS: user RPC add_edit_credits is rejected (execute revoked)';
end $$;

do $$
begin
  perform public.grant_credit_purchase('00000000-0000-4000-8000-00000000c001', 'cs_user_forged', 100, 0, 'usd');
  raise exception 'FAIL: user could call grant_credit_purchase';
exception when insufficient_privilege then
  raise notice 'PASS: user RPC grant_credit_purchase is rejected (execute revoked)';
end $$;

do $$
begin
  if public.consume_edit_credit('00000000-0000-4000-8000-00000000c001') then
    raise exception 'FAIL: consume_edit_credit spent a credit from an empty balance';
  end if;
  raise notice 'PASS: user RPC consume_edit_credit(self) returns false at zero balance';
end $$;

do $$
begin
  perform public.consume_edit_credit('00000000-0000-4000-8000-00000000c002');
  raise exception 'FAIL: user could spend another user''s credits';
exception when insufficient_privilege then
  raise notice 'PASS: user RPC consume_edit_credit(other user) is rejected';
end $$;

do $$
begin
  perform * from public.credit_purchases;
  raise exception 'FAIL: user could read credit_purchases';
exception when insufficient_privilege then
  raise notice 'PASS: user SELECT on credit_purchases is rejected';
end $$;

reset role;
select set_config('request.jwt.claims', '', true);

---------------------------------------------------------------------------
-- As the service role (the Stripe webhook).
---------------------------------------------------------------------------
set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);

do $$
declare bal integer;
begin
  bal := public.grant_credit_purchase('00000000-0000-4000-8000-00000000c001', 'cs_test_1', 100, 500, 'usd');
  if bal <> 100 then
    raise exception 'FAIL: first grant returned balance %', bal;
  end if;
  if (select count(*) from public.credit_purchases where checkout_session_id = 'cs_test_1') <> 1 then
    raise exception 'FAIL: ledger row missing';
  end if;
  raise notice 'PASS: service role grant_credit_purchase writes the ledger row and the balance (100)';
end $$;

do $$
declare bal integer;
begin
  bal := public.grant_credit_purchase('00000000-0000-4000-8000-00000000c001', 'cs_test_1', 100, 500, 'usd');
  if bal is not null then
    raise exception 'FAIL: redelivered session granted again (balance %)', bal;
  end if;
  if (select edit_credits from public.user_usage where user_id = '00000000-0000-4000-8000-00000000c001') <> 100 then
    raise exception 'FAIL: balance changed on redelivery';
  end if;
  raise notice 'PASS: a redelivered checkout session grants nothing (NULL) and leaves the balance at 100';
end $$;

do $$
declare bal integer;
begin
  bal := public.grant_credit_purchase('00000000-0000-4000-8000-00000000c001', 'cs_test_2', 100, 500, 'usd');
  if bal <> 200 then
    raise exception 'FAIL: second pack returned balance %', bal;
  end if;
  raise notice 'PASS: a second session adds to the balance (200)';
end $$;

-- A user who never used an AI edit has no user_usage row yet.
delete from public.user_usage where user_id = '00000000-0000-4000-8000-00000000c002';
do $$
declare bal integer;
begin
  bal := public.grant_credit_purchase('00000000-0000-4000-8000-00000000c002', 'cs_test_3', 100, 500, 'usd');
  if bal <> 100 then
    raise exception 'FAIL: grant without a user_usage row returned %', bal;
  end if;
  raise notice 'PASS: grant creates the user_usage row when missing';
end $$;

do $$
begin
  perform public.grant_credit_purchase('00000000-0000-4000-8000-00000000c002', 'cs_test_bad', 0, 0, 'usd');
  raise exception 'FAIL: zero-credit grant accepted';
exception when others then
  if sqlerrm not like 'grant_credit_purchase: p_credits must be positive' then raise; end if;
  raise notice 'PASS: zero-credit grant is rejected';
end $$;

reset role;
select set_config('request.jwt.claims', '', true);

---------------------------------------------------------------------------
-- As user 1 again: spending works through the guard, one credit at a time.
---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-00000000c001","role":"authenticated"}', true);

do $$
declare ok boolean; n integer;
begin
  ok := public.consume_edit_credit('00000000-0000-4000-8000-00000000c001');
  select edit_credits into n from public.user_usage where user_id = '00000000-0000-4000-8000-00000000c001';
  if not ok or n <> 199 then
    raise exception 'FAIL: consume_edit_credit returned % and left the balance at %', ok, n;
  end if;
  raise notice 'PASS: user RPC consume_edit_credit(self) spends one credit through the guard (200 -> 199)';
end $$;

reset role;
select set_config('request.jwt.claims', '', true);

-- Draining to zero stops at zero.
update public.user_usage set edit_credits = 1 where user_id = '00000000-0000-4000-8000-00000000c001';

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-00000000c001","role":"authenticated"}', true);

do $$
declare n integer;
begin
  if not public.consume_edit_credit('00000000-0000-4000-8000-00000000c001') then
    raise exception 'FAIL: last credit could not be spent';
  end if;
  if public.consume_edit_credit('00000000-0000-4000-8000-00000000c001') then
    raise exception 'FAIL: spent past zero';
  end if;
  select edit_credits into n from public.user_usage where user_id = '00000000-0000-4000-8000-00000000c001';
  if n <> 0 then
    raise exception 'FAIL: balance after draining is %', n;
  end if;
  raise notice 'PASS: credits drain to exactly 0 and the next spend returns false';
end $$;

reset role;
select set_config('request.jwt.claims', '', true);

do $$ begin raise notice 'ALL PASSED'; end $$;

rollback;
