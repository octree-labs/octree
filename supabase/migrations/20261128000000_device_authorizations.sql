-- Device authorization for headless agents (OAuth 2.0 Device Authorization
-- Grant, RFC 8628 style): app/api/v1/device/code, app/api/v1/device/token,
-- the /activate page, lib/device/*.
--
-- One row per device authorization request:
--   pending   -> issued, waiting for the user at /activate
--   approved  -> the user approved; an API key was created for them and its
--                plaintext is held here ENCRYPTED (key_ciphertext, AES-256-GCM,
--                lib/device/crypto.ts) until the agent polls once
--   consumed  -> the agent received the key; key_ciphertext is cleared
--   denied    -> the user said no
--   expired   -> not finished within expires_in (15 minutes)
--
-- Only the sha256 of the device_code is stored (device_code_hash). user_code
-- is unique among live (pending/approved) rows so a code names one request.
--
-- RLS enabled with NO policies: anon and authenticated never read or write
-- this table; only the service role (server code) does. The hourly cron
-- app/api/cron/api-artifacts purges old rows.
--
-- Idempotent.
--
-- Read-only checks after applying:
--   select count(*), status from public.device_authorizations group by status;
--   select relrowsecurity from pg_class where relname = 'device_authorizations';

create table if not exists public.device_authorizations (
  id uuid primary key default gen_random_uuid(),
  device_code_hash text not null,
  user_code text not null,
  client_name text,
  scope text not null default 'compile',
  status text not null default 'pending',
  user_id uuid references auth.users(id) on delete cascade,
  api_key_id uuid references public.api_keys(id) on delete set null,
  key_ciphertext text,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  approved_at timestamptz,
  consumed_at timestamptz,
  last_polled_at timestamptz,
  ip text,
  constraint device_authorizations_status check (status in ('pending', 'approved', 'denied', 'consumed', 'expired')),
  constraint device_authorizations_scope check (scope in ('compile')),
  constraint device_authorizations_hash_shape check (device_code_hash ~ '^[0-9a-f]{64}$'),
  constraint device_authorizations_user_code_shape check (user_code ~ '^[BCDFGHJKLMNPQRSTVWXZ]{4}-[BCDFGHJKLMNPQRSTVWXZ]{4}$'),
  constraint device_authorizations_client_name_length check (client_name is null or char_length(client_name) between 1 and 60),
  -- The plaintext key is only ever held while approved and not yet collected.
  constraint device_authorizations_ciphertext_only_approved check (key_ciphertext is null or status = 'approved')
);

create unique index if not exists device_authorizations_device_code_hash_key
  on public.device_authorizations (device_code_hash);

create unique index if not exists device_authorizations_live_user_code_key
  on public.device_authorizations (user_code)
  where status in ('pending', 'approved');

create index if not exists device_authorizations_user_code_idx
  on public.device_authorizations (user_code);

create index if not exists device_authorizations_expires_at_idx
  on public.device_authorizations (expires_at);

alter table public.device_authorizations enable row level security;
-- No policies on purpose: only the service role (which bypasses RLS) uses it.
revoke all on public.device_authorizations from anon, authenticated;
grant all on public.device_authorizations to service_role;
