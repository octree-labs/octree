-- Public compile API and MCP server ("Octree for agents").
--
-- * api_keys          - one row per API key. Only the sha256 of the key is
--                       stored (key_hash); the plaintext `oct_live_...` is
--                       shown once at creation. Users see and manage their
--                       own rows (RLS) but can never read key_hash, and may
--                       only rename or revoke a key once it exists. At most
--                       5 active (not revoked) keys per user (trigger).
-- * api_usage_daily   - compiles per user per UTC day. Service-role only.
-- * increment_api_usage(p_user_id, p_day) -> int
--                     - atomic +1, returns the new count. Service-role only,
--                       called by lib/api/compile.ts before every compile.
--
-- Nothing here touches user_usage or its column-guard triggers. Idempotent.

create table if not exists public.api_keys (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  key_prefix text not null,
  key_hash text not null,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz,
  constraint api_keys_name_length check (char_length(name) between 1 and 64),
  constraint api_keys_prefix_shape check (key_prefix ~ '^oct_live_[A-Za-z0-9_-]{3}$'),
  constraint api_keys_hash_shape check (key_hash ~ '^[0-9a-f]{64}$')
);

create unique index if not exists api_keys_key_hash_key on public.api_keys (key_hash);
create index if not exists api_keys_user_id_idx on public.api_keys (user_id) where revoked_at is null;

alter table public.api_keys enable row level security;

drop policy if exists "api_keys_select_own" on public.api_keys;
create policy "api_keys_select_own" on public.api_keys
  for select to authenticated
  using (user_id = auth.uid());

drop policy if exists "api_keys_insert_own" on public.api_keys;
create policy "api_keys_insert_own" on public.api_keys
  for insert to authenticated
  with check (user_id = auth.uid() and revoked_at is null and last_used_at is null);

drop policy if exists "api_keys_update_own" on public.api_keys;
create policy "api_keys_update_own" on public.api_keys
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Column privileges: the hash is never readable through the API, and after
-- creation a user can only rename or revoke. anon gets nothing.
revoke all on public.api_keys from anon, authenticated;
grant select (id, user_id, name, key_prefix, created_at, last_used_at, revoked_at)
  on public.api_keys to authenticated;
grant insert (user_id, name, key_prefix, key_hash) on public.api_keys to authenticated;
grant update (name, revoked_at) on public.api_keys to authenticated;
grant all on public.api_keys to service_role;

-- A revoked key stays revoked; the active-key cap holds for every writer.
create or replace function public.api_keys_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' and old.revoked_at is not null
     and (new.revoked_at is null or new.revoked_at <> old.revoked_at) then
    raise exception 'api key is already revoked' using errcode = 'check_violation';
  end if;

  if tg_op = 'INSERT' and new.revoked_at is null then
    perform pg_advisory_xact_lock(hashtext('api_keys:' || new.user_id::text));
    if (
      select count(*) from public.api_keys
      where user_id = new.user_id and revoked_at is null
    ) >= 5 then
      raise exception 'api key limit reached (5 active keys)' using errcode = 'check_violation';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists api_keys_guard on public.api_keys;
create trigger api_keys_guard
  before insert or update on public.api_keys
  for each row execute function public.api_keys_guard();

-- ---------------------------------------------------------------------------
-- Daily usage
-- ---------------------------------------------------------------------------

create table if not exists public.api_usage_daily (
  user_id uuid not null references auth.users(id) on delete cascade,
  day date not null,
  compiles integer not null default 0,
  primary key (user_id, day)
);

alter table public.api_usage_daily enable row level security;
-- No policies: only the service role (which bypasses RLS) reads or writes.
revoke all on public.api_usage_daily from anon, authenticated;
grant all on public.api_usage_daily to service_role;

create or replace function public.increment_api_usage(p_user_id uuid, p_day date)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  if p_user_id is null or p_day is null then
    raise exception 'increment_api_usage: p_user_id and p_day are required'
      using errcode = 'invalid_parameter_value';
  end if;

  insert into public.api_usage_daily as u (user_id, day, compiles)
  values (p_user_id, p_day, 1)
  on conflict (user_id, day) do update set compiles = u.compiles + 1
  returning u.compiles into v_count;

  return v_count;
end;
$$;

revoke execute on function public.increment_api_usage(uuid, date) from public, anon, authenticated;
grant execute on function public.increment_api_usage(uuid, date) to service_role;
revoke execute on function public.api_keys_guard() from public, anon, authenticated;
