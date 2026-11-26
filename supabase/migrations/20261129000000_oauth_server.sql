-- OAuth 2.1 authorization server for the MCP server and the public API
-- (lib/oauth/*, app/oauth/*, app/.well-known/*).
--
-- Access tokens are ordinary Octree API keys (`oct_live_...`, api_keys) with
-- kind = 'oauth', a one-hour expires_at and the grant they belong to. They
-- only work on /api/v1/* and /api/mcp (compile + usage), never on PostgREST,
-- Storage, the compile service or the agent: unlike a Supabase session JWT,
-- an API key is not a database credential.
--
-- * oauth_clients              - clients registered through Dynamic Client
--                                Registration (POST /oauth/register). Public
--                                clients only (no secrets). Clients that use a
--                                Client ID Metadata Document (an https URL as
--                                client_id) have no row here.
-- * oauth_authorization_codes  - single-use, 60 seconds, bound to client,
--                                redirect_uri, PKCE challenge and user. Only
--                                the sha256 of the code is stored.
-- * oauth_grants               - one per approved connection ("Connected
--                                apps" in Settings). Users can list their own
--                                and revoke them; revoking also revokes the
--                                grant's access tokens (trigger below).
--                                At most 20 active grants per user.
-- * oauth_refresh_tokens       - rotated on every use; a used one presented
--                                again revokes the whole grant. Only the
--                                sha256 is stored.
-- * api_keys                   - new columns kind ('manual' | 'device' |
--                                'oauth'), expires_at, oauth_grant_id. OAuth
--                                keys do not count toward the 5-key cap.
--
-- Codes, clients and refresh tokens: RLS on with no policies (service role
-- only). The hourly cron app/api/cron/api-artifacts purges old rows.
--
-- Idempotent. Apply BEFORE deploying the code that reads api_keys.kind.
--
-- Read-only checks after applying:
--   select kind, count(*) from public.api_keys group by kind;
--   select count(*) from public.oauth_grants where revoked_at is null;
--   select relname, relrowsecurity from pg_class
--     where relname in ('oauth_clients','oauth_authorization_codes','oauth_grants','oauth_refresh_tokens');

-- ---------------------------------------------------------------------------
-- Clients (Dynamic Client Registration)
-- ---------------------------------------------------------------------------

create table if not exists public.oauth_clients (
  id uuid primary key default gen_random_uuid(),
  client_name text,
  redirect_uris text[] not null,
  client_uri text,
  software_id text,
  software_version text,
  registration_ip text,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  constraint oauth_clients_name_length check (client_name is null or char_length(client_name) between 1 and 60),
  constraint oauth_clients_redirect_uris_count check (cardinality(redirect_uris) between 1 and 10),
  constraint oauth_clients_client_uri_length check (client_uri is null or char_length(client_uri) <= 512),
  constraint oauth_clients_software_length check (
    (software_id is null or char_length(software_id) <= 128)
    and (software_version is null or char_length(software_version) <= 64)
  )
);

create index if not exists oauth_clients_created_at_idx on public.oauth_clients (created_at);

alter table public.oauth_clients enable row level security;
revoke all on public.oauth_clients from anon, authenticated;
grant all on public.oauth_clients to service_role;

-- ---------------------------------------------------------------------------
-- Grants (one per approved connection)
-- ---------------------------------------------------------------------------

create table if not exists public.oauth_grants (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  -- A DCR client's uuid, or a Client ID Metadata Document URL.
  client_id text not null,
  client_kind text not null,
  client_name text,
  scope text not null default 'compile',
  resource text,
  created_at timestamptz not null default now(),
  last_refreshed_at timestamptz,
  revoked_at timestamptz,
  revoked_reason text,
  constraint oauth_grants_client_kind check (client_kind in ('dcr', 'cimd')),
  constraint oauth_grants_client_id_length check (char_length(client_id) between 1 and 512),
  constraint oauth_grants_client_name_length check (client_name is null or char_length(client_name) between 1 and 60),
  constraint oauth_grants_scope check (scope in ('compile', 'compile offline_access')),
  constraint oauth_grants_revoked_reason check (
    revoked_reason is null
    or revoked_reason in ('user', 'client', 'refresh_reuse', 'code_reuse', 'expired', 'failed')
  )
);

create index if not exists oauth_grants_user_active_idx on public.oauth_grants (user_id) where revoked_at is null;
create index if not exists oauth_grants_created_at_idx on public.oauth_grants (created_at);

alter table public.oauth_grants enable row level security;

drop policy if exists "oauth_grants_select_own" on public.oauth_grants;
create policy "oauth_grants_select_own" on public.oauth_grants
  for select to authenticated
  using (user_id = auth.uid());

drop policy if exists "oauth_grants_update_own" on public.oauth_grants;
create policy "oauth_grants_update_own" on public.oauth_grants
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Users read their grants and can only revoke them (Settings > Connected apps).
revoke all on public.oauth_grants from anon, authenticated;
grant select (id, user_id, client_id, client_kind, client_name, scope, created_at, last_refreshed_at, revoked_at)
  on public.oauth_grants to authenticated;
grant update (revoked_at, revoked_reason) on public.oauth_grants to authenticated;
grant all on public.oauth_grants to service_role;

-- A revoked grant stays revoked, the 20-grant cap holds for every writer,
-- and revoking a grant revokes its access tokens.
create or replace function public.oauth_grants_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' and old.revoked_at is not null
     and (new.revoked_at is null or new.revoked_at <> old.revoked_at) then
    raise exception 'oauth grant is already revoked' using errcode = 'check_violation';
  end if;

  if tg_op = 'INSERT' and new.revoked_at is null then
    perform pg_advisory_xact_lock(hashtext('oauth_grants:' || new.user_id::text));
    if (
      select count(*) from public.oauth_grants
      where user_id = new.user_id and revoked_at is null
    ) >= 20 then
      raise exception 'oauth grant limit reached (20 connected apps)' using errcode = 'check_violation';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists oauth_grants_guard on public.oauth_grants;
create trigger oauth_grants_guard
  before insert or update on public.oauth_grants
  for each row execute function public.oauth_grants_guard();

-- ---------------------------------------------------------------------------
-- Authorization codes
-- ---------------------------------------------------------------------------

create table if not exists public.oauth_authorization_codes (
  id uuid primary key default gen_random_uuid(),
  code_hash text not null,
  client_id text not null,
  client_kind text not null,
  client_name text,
  redirect_uri text not null,
  code_challenge text not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  scope text not null,
  resource text,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz,
  grant_id uuid references public.oauth_grants(id) on delete set null,
  constraint oauth_codes_hash_shape check (code_hash ~ '^[0-9a-f]{64}$'),
  constraint oauth_codes_challenge_shape check (code_challenge ~ '^[A-Za-z0-9_-]{43}$'),
  constraint oauth_codes_client_kind check (client_kind in ('dcr', 'cimd')),
  constraint oauth_codes_redirect_length check (char_length(redirect_uri) <= 2000)
);

create unique index if not exists oauth_authorization_codes_hash_key on public.oauth_authorization_codes (code_hash);
create index if not exists oauth_authorization_codes_expires_at_idx on public.oauth_authorization_codes (expires_at);

alter table public.oauth_authorization_codes enable row level security;
revoke all on public.oauth_authorization_codes from anon, authenticated;
grant all on public.oauth_authorization_codes to service_role;

-- ---------------------------------------------------------------------------
-- Refresh tokens
-- ---------------------------------------------------------------------------

create table if not exists public.oauth_refresh_tokens (
  id uuid primary key default gen_random_uuid(),
  grant_id uuid not null references public.oauth_grants(id) on delete cascade,
  token_hash text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz,
  constraint oauth_refresh_tokens_hash_shape check (token_hash ~ '^[0-9a-f]{64}$')
);

create unique index if not exists oauth_refresh_tokens_hash_key on public.oauth_refresh_tokens (token_hash);
create index if not exists oauth_refresh_tokens_grant_idx on public.oauth_refresh_tokens (grant_id);
create index if not exists oauth_refresh_tokens_expires_at_idx on public.oauth_refresh_tokens (expires_at);

alter table public.oauth_refresh_tokens enable row level security;
revoke all on public.oauth_refresh_tokens from anon, authenticated;
grant all on public.oauth_refresh_tokens to service_role;

-- ---------------------------------------------------------------------------
-- api_keys: kind, expiry, grant
-- ---------------------------------------------------------------------------

alter table public.api_keys add column if not exists kind text not null default 'manual';
alter table public.api_keys add column if not exists expires_at timestamptz;
alter table public.api_keys add column if not exists oauth_grant_id uuid references public.oauth_grants(id) on delete cascade;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'api_keys_kind') then
    alter table public.api_keys add constraint api_keys_kind check (kind in ('manual', 'device', 'oauth'));
  end if;
  -- OAuth keys always expire and belong to a grant; other keys never do.
  if not exists (select 1 from pg_constraint where conname = 'api_keys_oauth_shape') then
    alter table public.api_keys add constraint api_keys_oauth_shape check (
      (kind = 'oauth' and oauth_grant_id is not null and expires_at is not null)
      or (kind <> 'oauth' and oauth_grant_id is null and expires_at is null)
    );
  end if;
end;
$$;

create index if not exists api_keys_oauth_grant_idx on public.api_keys (oauth_grant_id) where oauth_grant_id is not null;
create index if not exists api_keys_oauth_expires_idx on public.api_keys (expires_at) where kind = 'oauth';

-- Users may create manual and device keys only; OAuth keys are written by
-- the token endpoint with the service role.
drop policy if exists "api_keys_insert_own" on public.api_keys;
create policy "api_keys_insert_own" on public.api_keys
  for insert to authenticated
  with check (
    user_id = auth.uid()
    and revoked_at is null
    and last_used_at is null
    and kind in ('manual', 'device')
    and expires_at is null
    and oauth_grant_id is null
  );

grant select (kind, expires_at, oauth_grant_id) on public.api_keys to authenticated;
grant insert (kind) on public.api_keys to authenticated;

-- Same guard as 20261109000000_api_keys.sql, with the 5-key cap counting
-- manual and device keys only.
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

  if tg_op = 'INSERT' and new.revoked_at is null and new.kind <> 'oauth' then
    perform pg_advisory_xact_lock(hashtext('api_keys:' || new.user_id::text));
    if (
      select count(*) from public.api_keys
      where user_id = new.user_id and revoked_at is null and kind <> 'oauth'
    ) >= 5 then
      raise exception 'api key limit reached (5 active keys)' using errcode = 'check_violation';
    end if;
  end if;

  return new;
end;
$$;

-- Revoking a grant (Settings, /oauth/revoke, refresh-token reuse) revokes
-- its access tokens in the same transaction.
create or replace function public.oauth_grants_revoke_keys()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.revoked_at is not null and old.revoked_at is null then
    update public.api_keys
      set revoked_at = new.revoked_at
      where oauth_grant_id = new.id and revoked_at is null;
  end if;
  return new;
end;
$$;

drop trigger if exists oauth_grants_revoke_keys on public.oauth_grants;
create trigger oauth_grants_revoke_keys
  after update of revoked_at on public.oauth_grants
  for each row execute function public.oauth_grants_revoke_keys();

revoke execute on function public.oauth_grants_guard() from public, anon, authenticated;
revoke execute on function public.oauth_grants_revoke_keys() from public, anon, authenticated;
revoke execute on function public.api_keys_guard() from public, anon, authenticated;
