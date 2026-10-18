-- Lifecycle and win-back emails (app/api/cron/lifecycle).
--
-- lifecycle_emails: one row per (user, template) ever sent. The unique key is
-- the dedupe: the cron inserts before it reports success, and a second run
-- can never send the same template to the same person twice. Service role
-- only; nothing in the browser reads it.
--
-- email_preferences: the marketing opt-out a user sets through the
-- unsubscribe link in every lifecycle email. A user may read and update their
-- own row; the cron (service role) reads all of them before sending.

create table if not exists public.lifecycle_emails (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  email text not null,
  template text not null,
  sent_at timestamptz not null default now(),
  resend_id text,
  unique (user_id, template)
);

alter table public.lifecycle_emails enable row level security;

revoke all on table public.lifecycle_emails from anon, authenticated;
grant all on table public.lifecycle_emails to service_role;

create table if not exists public.email_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  marketing_opt_out boolean not null default false,
  updated_at timestamptz default now()
);

alter table public.email_preferences enable row level security;

revoke all on table public.email_preferences from anon;
grant select, insert, update on table public.email_preferences to authenticated;
grant all on table public.email_preferences to service_role;

drop policy if exists "Users can read their own email preferences" on public.email_preferences;
create policy "Users can read their own email preferences"
  on public.email_preferences for select to authenticated
  using (auth.uid() = user_id);

drop policy if exists "Users can create their own email preferences" on public.email_preferences;
create policy "Users can create their own email preferences"
  on public.email_preferences for insert to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "Users can update their own email preferences" on public.email_preferences;
create policy "Users can update their own email preferences"
  on public.email_preferences for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
