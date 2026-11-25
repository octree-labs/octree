-- Agent-friendly compile output (lib/api/artifacts.ts, lib/api/compile.ts).
--
-- 1. Bucket `api-artifacts`: PDFs compiled through POST /api/v1/compile
--    (JSON answers) and the MCP compile_latex tool, at
--    `<YYYY-MM-DD>/<user id>/<uuid>.pdf`, handed out as one-hour signed
--    URLs. Private and without storage policies on purpose: anon and
--    authenticated never touch it; only the service role uploads, signs and
--    deletes. The hourly cron app/api/cron/api-artifacts deletes objects
--    older than 24 hours.
--
-- 2. `api_usage_daily.checks` + `increment_api_check_usage`: the MCP
--    check_latex tool counts on its own daily counter (API_*_DAILY_CHECKS in
--    data/constants.ts), so validating edits does not use up the compile
--    quota. Until this is applied the app counts checks as compiles.
--
-- Rollout: the app code works before and after this migration (no PDF link
-- while the bucket is missing, checks on the compile counter while the
-- function is missing). Idempotent.
--
-- Read-only checks after applying:
--   select id, public, file_size_limit, allowed_mime_types from storage.buckets where id = 'api-artifacts';
--   select count(*) from storage.objects where bucket_id = 'api-artifacts';
--   select column_name from information_schema.columns
--   where table_schema = 'public' and table_name = 'api_usage_daily';

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('api-artifacts', 'api-artifacts', false, 52428800, array['application/pdf'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

alter table public.api_usage_daily
  add column if not exists checks integer not null default 0;

create or replace function public.increment_api_check_usage(p_user_id uuid, p_day date)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  if p_user_id is null or p_day is null then
    raise exception 'increment_api_check_usage: p_user_id and p_day are required'
      using errcode = 'invalid_parameter_value';
  end if;

  insert into public.api_usage_daily as u (user_id, day, checks)
  values (p_user_id, p_day, 1)
  on conflict (user_id, day) do update set checks = u.checks + 1
  returning u.checks into v_count;

  return v_count;
end;
$$;

revoke execute on function public.increment_api_check_usage(uuid, date) from public, anon, authenticated;
grant execute on function public.increment_api_check_usage(uuid, date) to service_role;
